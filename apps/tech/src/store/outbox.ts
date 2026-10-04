// The offline outbox. Every action the technician takes is written here first,
// with a client-generated event ID, and sent when the phone has signal. Nothing
// a technician does is lost because a basement had none.
//
// The ordering rules are in ./replay.ts; this file is the store and the sending.

import type { Moved } from "@maneman/web-kit/api";
import { reportClientError } from "@maneman/web-kit/client-errors";
import {
  ALREADY_CLOSED,
  api,
  type Answer,
  OUT_OF_ORDER,
  pathFor,
  SUPERSEDED,
  TOO_EARLY_TO_ARRIVE,
  TOO_EARLY_TO_CLOSE,
  unreachable,
  type Angle,
  type CheckIn,
  type EventKind,
  type JobState,
  type Phase,
} from "../api.ts";
import { add, all, get, put, remove } from "./db.ts";
import {
  forgetMarks,
  forgetStartAtCheckIn,
  keepArrival,
  keepJob,
  keepLanded,
  keepStartAtCheckIn,
  keptStartAtCheckIn,
} from "./jobs.ts";
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
  /** Its thumbnail, for the client app's rows; missing from a frame kept before the phone made them. */
  readonly small?: Blob;
  /** The take the API answered once the photograph was up; only its thumbnail is still to go. */
  readonly take?: string;
  /** True once the API refused the file itself. The angle is taken again, which replaces this frame. */
  readonly refused?: true;
  readonly kept_at: number;
}

/** Why a replay stopped short, so the screen can say it plainly. */
export type Stopped = "offline" | "signed-out" | null;

type Refused = Extract<Answer<unknown>, { readonly ok: false }>;

/** A job no longer this technician's, as the API said it: the code, what changed, and whom it went to. */
interface Gone {
  readonly kind: "gone";
  readonly note: string;
  readonly fields: readonly string[];
  readonly moved: Moved | null;
}

/** A photograph the API would not take, as it answered. */
interface Rejected {
  readonly kind: "rejected";
  readonly answer: Refused;
}

/** Why a photograph could not go up: no signal, signed out, the job gone from the phone, or the file refused. */
type Trouble = "offline" | "signed-out" | Gone | Rejected;

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
 *
 * A step already waiting is not queued a second time: a second tap on a gloved
 * screen, or the screen opened twice, sends it once. `startsAt` is the job's
 * start as the card said when the technician acted, which the API checks
 * against the one it holds; once he has checked in, the start the card said
 * then.
 */
export async function queue(
  kind: EventKind,
  jobId: string,
  body: unknown,
  startsAt: string | null = null,
): Promise<Queued> {
  const already = (await events()).find(
    (event) => event.job_id === jobId && event.kind === kind && event.state === "waiting",
  );
  if (already !== undefined) return already;

  const event = {
    id: uuidv7(),
    job_id: jobId,
    kind,
    path: pathFor(kind, jobId),
    body,
    queued_at: Date.now(),
    starts_at: await startSentWith(kind, jobId, startsAt),
    state: "waiting" as const,
    note: null,
    fields: [],
  };
  const seq = await add("outbox", event);
  changed();
  return { ...event, seq };
}

/**
 * The start a step is sent with. A check-in keeps the card's; every later step of the job carries that same start,
 * so a move ops make once the technician has arrived is refused rather than taken in by a card read again since.
 */
async function startSentWith(kind: EventKind, jobId: string, startsAt: string | null): Promise<string | null> {
  if (kind === "check_in") {
    if (startsAt !== null) await keepStartAtCheckIn(jobId, startsAt);
    return startsAt;
  }
  return (await keptStartAtCheckIn(jobId)) ?? startsAt;
}

/**
 * A step the API refused, sent again as the technician corrected it. It keeps
 * its place in the queue, so the steps queued behind it follow it, and it goes
 * under a new event ID, since the API recorded nothing of the refused one.
 */
export async function correct(seq: number, body: unknown): Promise<void> {
  const refused = await get<Queued>("outbox", seq);
  if (refused === null) return;
  await put("outbox", { ...refused, id: uuidv7(), body, state: "waiting", note: null, fields: [], request_id: null });
  changed();
}

/**
 * A photograph frame and its thumbnail, held on the phone until the API
 * confirms their upload and never written to the phone's gallery (the design's
 * line on board A2).
 *
 * One frame per angle: the API keeps one photograph for each, so a second
 * frame for the same angle — a double tap — replaces the first rather than
 * standing in for the next angle.
 */
export async function keepFrame(jobId: string, angle: Angle, phase: Phase, frame: Blob, small?: Blob): Promise<string> {
  const id = `${jobId}:${phase}:${angle}`;
  const kept: Frame = {
    id,
    job_id: jobId,
    angle,
    phase,
    frame,
    kept_at: Date.now(),
    ...(small === undefined ? {} : { small }),
  };
  await put("frames", kept);
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
  await forgetMarks(jobId);
  await forgetStartAtCheckIn(jobId);
  changed();
}

async function markStopped(
  event: Queued,
  state: "superseded" | "refused",
  note: string,
  fields: readonly string[],
  moved: Moved | null = null,
  requestId: string | null = null,
): Promise<void> {
  const current = await get<Queued>("outbox", event.seq);
  if (current === null) return;
  await put("outbox", { ...current, state, note, fields, moved, request_id: requestId });
}

/** A job ops moved to another time is read again, so the phone holds the start it moved to and can say so. */
async function readAgainIfMoved(jobId: string, fields: readonly string[]): Promise<void> {
  if (!fields.includes("time")) return;
  const answer = await api.job(jobId);
  if (answer.ok) await keepJob(answer.body).catch(() => undefined);
}

/**
 * A write the API refused: its job stops there for the technician to put right, and the refusal is reported, since
 * nothing else would tell anyone but him.
 */
async function giveUp(event: Queued, note: string, fields: readonly string[], answer: Refused): Promise<void> {
  await markStopped(event, "refused", note, fields, null, answer.requestId);
  reportClientError({
    kind: "outbox_gave_up",
    message: `${event.kind} refused: ${answer.code}`,
    step: event.kind,
    code: answer.code,
    status: answer.status,
    ...(answer.requestId === null ? {} : { request_id: answer.requestId }),
  });
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
 * link the API hands out, with its thumbnail, and only then does the set itself
 * go. The frames are dropped one by one as they land, so a replay interrupted
 * halfway does not send any of them twice. A frame the API refuses does not
 * hold back the others: they go up, so only the refused ones are taken again.
 */
async function uploadFrames(event: Queued, phase: Phase): Promise<Trouble | null> {
  const inTheOrderTaken = (await frames()).sort((a, b) => a.kept_at - b.kept_at);
  let firstRefusal: Rejected | null = null;
  for (const frame of inTheOrderTaken) {
    if (frame.job_id !== event.job_id || frame.phase !== phase) continue;
    const trouble = await uploadFrame(frame);
    if (trouble === null) {
      await remove("frames", frame.id);
      changed();
      continue;
    }
    if (!isRejected(trouble)) return trouble;
    firstRefusal ??= trouble;
  }
  return firstRefusal;
}

/**
 * One frame, the photograph first: the API answers it with its take, and takes
 * the thumbnail only for that take, so it is never kept beside another. The
 * take is kept with the frame, and a round stopped before the thumbnail sends
 * only the thumbnail the next time. A thumbnail the API refuses, because the
 * angle was taken again meanwhile or it is not small enough, is let go, since
 * the client app then shows the photograph itself.
 */
async function uploadFrame(frame: Frame): Promise<Trouble | null> {
  const link = await api.uploadLink(frame.job_id, frame.phase, frame.angle);
  if (!link.ok) return failureOf(link);
  let take = frame.take;
  if (take === undefined) {
    const sent = await api.upload(link.body.upload_url, frame.frame);
    if (!sent.ok) return markIfRefused(frame, failureOf(sent));
    // An API from before thumbnails names no take: the photograph goes alone.
    take = sent.body?.take;
    if (take === undefined) return null;
    await put("frames", { ...frame, take } satisfies Frame);
  }
  if (frame.small === undefined) return null;
  const sent = await api.uploadThumbnail(link.body.small_upload_url, take, frame.small);
  if (sent.ok) return null;
  const trouble = failureOf(sent);
  return isRejected(trouble) ? null : trouble;
}

const isRejected = (trouble: Trouble): trouble is Rejected =>
  typeof trouble === "object" && trouble.kind === "rejected";

/** A photograph the API would not take is marked, so the capture screen asks for its angle again. */
async function markIfRefused(frame: Frame, trouble: Trouble): Promise<Trouble> {
  if (isRejected(trouble)) await put("frames", { ...frame, refused: true } satisfies Frame);
  return trouble;
}

/**
 * What a failed call on the way to a write means for the round: wait, sign out,
 * or stop the job. A `409 superseded` is the API saying ops gave the job to
 * someone else, or cancelled it, and whom it went to; `already_closed`, that
 * the job has closed; a 404, that it is no longer on this technician's list.
 * The screens say each as the change it is, not as photographs that would not
 * upload.
 */
function failureOf(answer: Refused): Trouble {
  if (unreachable(answer)) return "offline";
  if (answer.status === 401) return "signed-out";
  if (answer.code === SUPERSEDED) return { kind: "gone", note: SUPERSEDED, fields: answer.fields, moved: answer.moved };
  if (answer.code === ALREADY_CLOSED) return { kind: "gone", note: ALREADY_CLOSED, fields: [], moved: null };
  if (answer.status === 404) return { kind: "gone", note: "not_found", fields: [], moved: null };
  return { kind: "rejected", answer };
}

/** Where the job stands as a landed write answered: its own progress, or that of the step a check-in or no-show made. */
function stateIn(body: unknown): JobState | null {
  const answer = body as { progress?: Partial<JobState>; accepted?: { progress?: Partial<JobState> } | null } | null;
  const progress = answer?.progress ?? answer?.accepted?.progress;
  if (progress === undefined) return null;
  return { started_at: progress.started_at ?? null, outcome: progress.outcome ?? null };
}

/**
 * The jobs whose last no-show the API refused as early, so the card can say so
 * and not move to a close-out. A no-show that lands takes its job off.
 */
const early = new Set<string>();

export const refusedAsEarly = (jobId: string): boolean => early.has(jobId);

/** The jobs whose last check-in the API refused as before the earliest check-in, so the card can say when it opens. */
const arrivedEarly = new Set<string>();

export const checkInRefusedAsEarly = (jobId: string): boolean => arrivedEarly.has(jobId);

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
      if (trouble?.kind === "rejected") {
        await giveUp(event, "photo_rejected", [], trouble.answer);
        refused += 1;
        changed();
        continue;
      }
      if (trouble !== null) {
        await markStopped(event, "superseded", trouble.note, trouble.fields, trouble.moved);
        await readAgainIfMoved(event.job_id, trouble.fields);
        superseded += 1;
        changed();
        continue;
      }
    }

    const answer = await api.send<unknown>(event.path, event.body ?? undefined, {
      eventId: event.id,
      startsAt: event.starts_at ?? null,
    });
    if (answer.ok) {
      // A check-in answers pass or fail with the distance; the job screen shows it.
      if (event.kind === "check_in") {
        await keepArrival(event.job_id, answer.body as CheckIn);
        arrivedEarly.delete(event.job_id);
      }
      const landed = stateIn(answer.body);
      if (landed !== null) await keepLanded(event.job_id, landed);
      if (event.kind === "no_show") early.delete(event.job_id);
      await remove("outbox", event.seq);
      sent += 1;
      changed();
      continue;
    }
    // No signal, or none usable: everything still waiting stays waiting.
    if (answer.code === "offline") return { sent, superseded, refused, stopped: "offline" };
    if (answer.status === 401) return { sent, superseded, refused, stopped: "signed-out" };
    // The job changed underneath the phone, or a step arrived before the one ahead of
    // it, or the job has closed, or it is no longer this technician's at all.
    const jobStopped = answer.code === SUPERSEDED || answer.code === OUT_OF_ORDER || answer.code === ALREADY_CLOSED;
    if (jobStopped || answer.status === 404) {
      await markStopped(event, "superseded", answer.code, answer.fields, answer.moved);
      await readAgainIfMoved(event.job_id, answer.fields);
      superseded += 1;
      changed();
      continue;
    }
    // The wait has not run out. Nothing is wrong with the job: the countdown goes on.
    if (answer.code === TOO_EARLY_TO_CLOSE) {
      early.add(event.job_id);
      await remove("outbox", event.seq);
      changed();
      continue;
    }
    // Before the earliest check-in. Nothing is wrong with the job: he taps again once it comes.
    if (answer.code === TOO_EARLY_TO_ARRIVE && event.kind === "check_in") {
      arrivedEarly.add(event.job_id);
      await remove("outbox", event.seq);
      changed();
      continue;
    }
    // Ours or theirs, and passing: try the whole queue again later.
    if (answer.status === 429 || answer.status >= 500) return { sent, superseded, refused, stopped: "offline" };
    await giveUp(event, answer.code, answer.fields, answer);
    refused += 1;
    changed();
  }
}
