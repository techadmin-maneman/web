// The offline outbox. Every action the technician takes is written here first,
// with a client-generated event ID, and sent when the phone has signal. Nothing
// a technician does is lost because a basement had none.
//
// The ordering rules are in ./replay.ts; this file is the store and the sending.

import { api, pathFor, SUPERSEDED } from "../api.ts";
import { add, all, get, put, remove } from "./db.ts";
import { account, nextToSend, type EventKind, type JobAccount, type Queued } from "./replay.ts";
import { uuidv7 } from "./uuidv7.ts";

export type { EventKind, JobAccount, Queued };
export { account } from "./replay.ts";

/** Why a replay stopped short, so the screen can say it plainly. */
export type Stopped = "offline" | "signed-out" | null;

export interface Replayed {
  readonly sent: number;
  readonly superseded: number;
  readonly refused: number;
  readonly stopped: Stopped;
}

const listeners = new Set<() => void>();

/** Screens re-read the outbox whenever it changes: a queue, a send, a supersede. */
export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  for (const listener of listeners) listener();
}

export function events(): Promise<Queued[]> {
  return all<Queued>("outbox");
}

/** The plain account of what has not yet reached us, one line per job. */
export async function held(): Promise<JobAccount[]> {
  return account(await events());
}

/**
 * Queues one write. The screen calls this and moves on: the job is recorded on
 * the phone whether or not there is signal.
 */
export async function queue(kind: EventKind, jobId: string, body: unknown): Promise<Queued> {
  const id = uuidv7();
  const event = {
    id,
    job_id: jobId,
    kind,
    path: pathFor(kind, jobId),
    body,
    queued_at: Date.now(),
    state: "waiting" as const,
    note: null,
  };
  const seq = await add("outbox", event);
  changed();
  return { ...event, seq };
}

/**
 * A photograph frame, held on the phone until the API confirms its upload and
 * never written to the phone's gallery (the design's line on board A2).
 */
export async function keepFrame(jobId: string, angle: string, phase: string, frame: Blob): Promise<string> {
  const id = uuidv7();
  await put("frames", { id, job_id: jobId, angle, phase, frame, kept_at: Date.now() });
  changed();
  return id;
}

export async function dropFrame(id: string): Promise<void> {
  await remove("frames", id);
  changed();
}

export async function frames(): Promise<{ id: string; job_id: string; angle: string; phase: string; frame: Blob }[]> {
  return all("frames");
}

/** After the technician has read what changed: the job's stopped events go, and its queue can run again. */
export async function forget(jobId: string): Promise<void> {
  for (const event of await events()) {
    if (event.job_id === jobId) await remove("outbox", event.seq);
  }
  for (const frame of await frames()) {
    if (frame.job_id === jobId) await remove("frames", frame.id);
  }
  changed();
}

async function markStopped(event: Queued, state: "superseded" | "refused", note: string | null): Promise<void> {
  const current = await get<Queued>("outbox", event.seq);
  if (current === null) return;
  await put("outbox", { ...current, state, note });
}

let running: Promise<Replayed> | null = null;

/**
 * Sends everything waiting, oldest first, one at a time so a job's own writes
 * arrive in order. A job that meets a `409 superseded` stops there and keeps
 * what changed; the other jobs go on.
 */
export function replay(): Promise<Replayed> {
  running ??= run().finally(() => {
    running = null;
    changed();
  });
  return running;
}

async function run(): Promise<Replayed> {
  let sent = 0;
  let superseded = 0;
  let refused = 0;

  for (;;) {
    const event = nextToSend(await events());
    if (event === null) return { sent, superseded, refused, stopped: null };

    const answer = await api.send("POST", event.path, event.body, { eventId: event.id });
    if (answer.ok) {
      await remove("outbox", event.seq);
      for (const frame of await frames()) {
        if (frame.job_id === event.job_id && event.kind === "photos") await remove("frames", frame.id);
      }
      sent += 1;
      changed();
      continue;
    }
    // No signal, or none usable: everything still waiting stays waiting.
    if (answer.code === "offline") return { sent, superseded, refused, stopped: "offline" };
    if (answer.status === 401) return { sent, superseded, refused, stopped: "signed-out" };
    // FSM changed underneath the phone. The job stops; the technician is told what changed.
    if (answer.status === 409 || answer.code === SUPERSEDED) {
      await markStopped(event, "superseded", answer.message);
      superseded += 1;
      changed();
      continue;
    }
    // Ours or theirs, and passing: try the whole queue again later.
    if (answer.status === 429 || answer.status >= 500) return { sent, superseded, refused, stopped: "offline" };
    await markStopped(event, "refused", answer.message);
    refused += 1;
    changed();
  }
}
