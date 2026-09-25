// The offline outbox. Every action the technician takes is written here first,
// with a client-generated event ID, and sent when the phone has signal. Nothing
// a technician does is lost because a basement had none.
//
// The ordering rules are in ./replay.ts; this file is the store and the sending.

import {
  api,
  OUT_OF_ORDER,
  pathFor,
  SUPERSEDED,
  TOO_EARLY_TO_CLOSE,
  unreachable,
  type Angle,
  type CheckIn,
  type EventKind,
  type Phase,
} from "../api.ts";
import { add, all, get, put, remove } from "./db.ts";
import { keepArrival } from "./jobs.ts";
import { account, nextToSend, type JobAccount, type Queued } from "./replay.ts";
import { uuidv7 } from "./uuidv7.ts";

export type { EventKind, JobAccount, Queued };
export { account } from "./replay.ts";

/** One photograph waiting on the phone, held until the API confirms its upload. */
export interface Frame {
  readonly id: string;
  readonly job_id: string;
  readonly angle: Angle;
  readonly phase: Phase;
  readonly frame: Blob;
  readonly kept_at: number;
}

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
    fields: [],
  };
  const seq = await add("outbox", event);
  changed();
  return { ...event, seq };
}

/**
 * A photograph frame, held on the phone until the API confirms its upload and
 * never written to the phone's gallery (the design's line on board A2).
 */
export async function keepFrame(jobId: string, angle: Angle, phase: Phase, frame: Blob): Promise<string> {
  const id = uuidv7();
  await put("frames", { id, job_id: jobId, angle, phase, frame, kept_at: Date.now() } satisfies Frame);
  changed();
  return id;
}

export async function dropFrame(id: string): Promise<void> {
  await remove("frames", id);
  changed();
}

export function frames(): Promise<Frame[]> {
  return all<Frame>("frames");
}

/** Every job with a write or a photograph that has not reached us: the phone keeps its card until they have. */
export async function unsentJobs(): Promise<Set<string>> {
  const held = [...(await events()), ...(await frames())];
  return new Set(held.map((each) => each.job_id));
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

async function markStopped(
  event: Queued,
  state: "superseded" | "refused",
  note: string,
  fields: readonly string[],
): Promise<void> {
  const current = await get<Queued>("outbox", event.seq);
  if (current === null) return;
  await put("outbox", { ...current, state, note, fields });
}

let running: Promise<Replayed> | null = null;

/**
 * Sends everything waiting, oldest first, one at a time so a job's own writes
 * arrive in order. A job that meets a `409` stops there and keeps what changed;
 * the other jobs go on.
 */
export function replay(): Promise<Replayed> {
  running ??= run().finally(() => {
    running = null;
    changed();
  });
  return running;
}

/**
 * A photograph set is not one call. Each frame still on the phone is PUT to a
 * link the API hands out, and only then does the set itself go. The frames are
 * dropped one by one as they land, so a replay interrupted halfway does not
 * send any of them twice.
 */
async function uploadFrames(event: Queued, phase: Phase): Promise<Stopped | "refused"> {
  for (const frame of await frames()) {
    if (frame.job_id !== event.job_id || frame.phase !== phase) continue;
    const link = await api.uploadLink(event.job_id, phase, frame.angle);
    if (!link.ok) return failureOf(link.status, link.code);
    const sent = await api.upload(link.body.upload_url, frame.frame);
    if (!sent.ok) return failureOf(sent.status, sent.code);
    await remove("frames", frame.id);
    changed();
  }
  return null;
}

/** What a failed call on the way to a write means for the round: wait, sign out, or refuse. */
function failureOf(status: number, code: string): Stopped | "refused" {
  if (unreachable({ status, code })) return "offline";
  return status === 401 ? "signed-out" : "refused";
}

async function run(): Promise<Replayed> {
  let sent = 0;
  let superseded = 0;
  let refused = 0;

  for (;;) {
    const event = nextToSend(await events());
    if (event === null) return { sent, superseded, refused, stopped: null };

    if (event.kind === "before_photos" || event.kind === "after_photos") {
      const phase: Phase = event.kind === "before_photos" ? "before" : "after";
      const trouble = await uploadFrames(event, phase);
      if (trouble === "offline" || trouble === "signed-out") {
        return { sent, superseded, refused, stopped: trouble };
      }
      if (trouble === "refused") {
        await markStopped(event, "refused", "photo_rejected", []);
        refused += 1;
        changed();
        continue;
      }
    }

    const answer = await api.send<unknown>(event.path, event.body ?? undefined, { eventId: event.id });
    if (answer.ok) {
      // A check-in answers pass or fail with the distance; the job screen shows it.
      if (event.kind === "check_in") await keepArrival(event.job_id, answer.body as CheckIn);
      await remove("outbox", event.seq);
      sent += 1;
      changed();
      continue;
    }
    // No signal, or none usable: everything still waiting stays waiting.
    if (answer.code === "offline") return { sent, superseded, refused, stopped: "offline" };
    if (answer.status === 401) return { sent, superseded, refused, stopped: "signed-out" };
    // FSM changed underneath the phone, or a step arrived before the one ahead of it.
    if (answer.code === SUPERSEDED || answer.code === OUT_OF_ORDER) {
      await markStopped(event, "superseded", answer.code, answer.fields);
      superseded += 1;
      changed();
      continue;
    }
    // The wait has not run out. Nothing is wrong with the job: the countdown goes on.
    if (answer.code === TOO_EARLY_TO_CLOSE) {
      await remove("outbox", event.seq);
      changed();
      continue;
    }
    // Ours or theirs, and passing: try the whole queue again later.
    if (answer.status === 429 || answer.status >= 500) return { sent, superseded, refused, stopped: "offline" };
    await markStopped(event, "refused", answer.code, answer.fields);
    refused += 1;
    changed();
  }
}
