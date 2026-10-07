// The offline outbox. Every action the technician takes is written here first,
// with a client-generated event ID, and sent when the phone has signal. Nothing
// a technician does is lost because a basement had none.
//
// The ordering rules are in ./replay.ts, and what each refusal means for the round
// in ./verdict.ts; this file is the store and the sending.

import type { Moved } from "@maneman/web-kit/api";
import { reportClientError } from "@maneman/web-kit/client-errors";
import {
  api,
  pathFor,
  type Angle,
  type CheckIn,
  type EventBody,
  type EventKind,
  type JobState,
  type Phase,
} from "../api.ts";
import { addUnless, all, firstIn, get, put, remove, STEP_INDEX } from "./db.ts";
import {
  forgetMarks,
  forgetStartAtCheckIn,
  keepArrival,
  keepJob,
  keepLanded,
  keepStartAtCheckIn,
  keptStartAtCheckIn,
} from "./jobs.ts";
import type { Frame } from "./records.ts";
import { account, nextToSend, type EventState, type JobAccount, type Queued } from "./replay.ts";
import { uuidv7 } from "./uuidv7.ts";
import { classify, type Verdict } from "./verdict.ts";

export type { EventKind, Frame, JobAccount, Queued };
export { account, checkInRefusedAsEarly, refusedAsEarly } from "./replay.ts";

/** Why a replay stopped short, so the screen can say it plainly. */
type Stopped = "offline" | "signed-out" | null;

type Refusal = Extract<Verdict, { readonly kind: "refused" }>;

interface Replayed {
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
  return all("outbox");
}

/** The plain account of what has not yet reached us, one line per job. */
export async function held(): Promise<JobAccount[]> {
  return account(await events());
}

/** One of a job's steps in a state, by the outbox's index. */
const stepIn = (jobId: string, kind: EventKind, state: EventState): IDBValidKey => [jobId, kind, state];

/**
 * Queues one write. The screen calls this and moves on: the job is recorded on
 * the phone whether or not there is signal.
 *
 * A step already waiting is not queued a second time: a second tap on a gloved
 * screen, or the screen opened twice, sends it once. `startsAt` is the job's
 * start as the card said when the technician acted, which the API checks
 * against the one it holds; once they have checked in, the start the card said
 * then.
 */
export async function queue<K extends EventKind>(
  kind: K,
  jobId: string,
  body: EventBody<K>,
  startsAt: string | null = null,
): Promise<Queued> {
  const waiting = stepIn(jobId, kind, "waiting");
  const already = await firstIn("outbox", STEP_INDEX, waiting);
  if (already !== null) return already;

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
  const kept = await addUnless("outbox", STEP_INDEX, waiting, event);
  if (kept.added) {
    changed();
    return { ...event, seq: kept.key };
  }
  // Another screen queued the same step a moment before this one.
  return (await get("outbox", kept.key)) ?? { ...event, seq: kept.key };
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
export async function correct(seq: number, body: EventBody<EventKind>): Promise<void> {
  const refused = await get("outbox", seq);
  if (refused === null) return;
  await put("outbox", { ...refused, id: uuidv7(), body, state: "waiting", note: null, fields: [], request_id: null });
  changed();
}

/**
 * A photograph frame and its thumbnail, held on the phone until the API
 * confirms their upload and never written to the phone's gallery (the design's
 * line on the Waiting screen).
 *
 * One frame per angle: the API keeps one photograph for each, so a second
 * frame for the same angle — a double tap — replaces the first rather than
 * standing in for the next angle.
 */
export async function keepFrame({
  jobId,
  angle,
  phase,
  frame,
  small,
}: {
  jobId: string;
  angle: Angle;
  phase: Phase;
  frame: Blob;
  small?: Blob;
}): Promise<string> {
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
  return all("frames");
}

/** Every job with a write or a photograph that has not reached us: the phone keeps its card until they have. */
export async function unsentJobs(): Promise<Set<string>> {
  const unsent = (await events()).filter((event) => event.state !== "early");
  return new Set([...unsent, ...(await frames())].map((each) => each.job_id));
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

async function markAs({
  event,
  state,
  note,
  fields,
  moved = null,
  requestId = null,
}: {
  event: Queued;
  state: Exclude<EventState, "waiting">;
  note: string;
  fields: readonly string[];
  moved?: Moved | null;
  requestId?: string | null;
}): Promise<void> {
  const current = await get("outbox", event.seq);
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
 * nothing else would tell anyone but them.
 */
async function giveUp(event: Queued, refusal: Refusal): Promise<void> {
  const { answer } = refusal;
  await markAs({
    event,
    state: "refused",
    note: refusal.note,
    fields: refusal.fields,
    moved: null,
    requestId: answer.requestId,
  });
  reportClientError({
    kind: "outbox_gave_up",
    message: `${event.kind} refused: ${answer.code}`,
    step: event.kind,
    code: answer.code,
    status: answer.status,
    ...(answer.requestId === null ? {} : { request_id: answer.requestId }),
  });
}

/** The job's step refused as early before this one, if any: one at a time is kept. */
async function dropEarlier(event: Queued): Promise<void> {
  const earlier = await firstIn("outbox", STEP_INDEX, stepIn(event.job_id, event.kind, "early"));
  if (earlier !== null) await remove("outbox", earlier.seq);
}

/**
 * A check-in before the earliest the job takes one, or a no-show before its wait ran out. Nothing is wrong with the
 * job: it is kept as early, so the card says so even after a reload, until the technician's next tap lands.
 */
async function keepEarly(event: Queued, code: string): Promise<void> {
  await dropEarlier(event);
  await markAs({ event, state: "early", note: code, fields: [] });
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
async function uploadFrames(event: Queued, phase: Phase): Promise<Verdict | null> {
  const inTheOrderTaken = (await frames()).sort((a, b) => a.kept_at - b.kept_at);
  let firstRefusal: Refusal | null = null;
  for (const frame of inTheOrderTaken) {
    if (frame.job_id !== event.job_id || frame.phase !== phase) continue;
    const verdict = await uploadFrame(frame);
    if (verdict === null) {
      await remove("frames", frame.id);
      changed();
      continue;
    }
    if (verdict.kind !== "refused") return verdict;
    firstRefusal ??= verdict;
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
async function uploadFrame(frame: Frame): Promise<Verdict | null> {
  const link = await api.uploadLink(frame.job_id, frame.phase, frame.angle);
  if (!link.ok) return classify(link);
  let take = frame.take;
  if (take === undefined) {
    const sent = await api.upload(link.body.upload_url, frame.frame);
    if (!sent.ok) return markIfRefused(frame, classify(sent));
    // An API from before thumbnails names no take: the photograph goes alone.
    take = sent.body?.take;
    if (take === undefined) return null;
    await put("frames", { ...frame, take } satisfies Frame);
  }
  if (frame.small === undefined) return null;
  const sent = await api.uploadThumbnail(link.body.small_upload_url, take, frame.small);
  if (sent.ok) return null;
  const verdict = classify(sent);
  return verdict.kind === "refused" ? null : verdict;
}

/** A photograph the API would not take is marked, so the capture screen asks for its angle again. */
async function markIfRefused(frame: Frame, verdict: Verdict): Promise<Verdict> {
  if (verdict.kind === "refused") await put("frames", { ...frame, refused: true } satisfies Frame);
  return verdict;
}

/** Where the job stands as a landed write answered: its own progress, or that of the step a check-in or no-show made. */
function stateIn(body: unknown): JobState | null {
  const answer = body as { progress?: Partial<JobState>; accepted?: { progress?: Partial<JobState> } | null } | null;
  const progress = answer?.progress ?? answer?.accepted?.progress;
  if (progress === undefined) return null;
  return { started_at: progress.started_at ?? null, outcome: progress.outcome ?? null };
}

/** What a landed write leaves on the phone: the arrival a check-in answered, where the job stands, and no early refusal. */
async function landed(event: Queued, body: unknown): Promise<void> {
  // A check-in answers pass or fail with the distance; the job screen shows it.
  if (event.kind === "check_in") await keepArrival(event.job_id, body as CheckIn);
  const state = stateIn(body);
  if (state !== null) await keepLanded(event.job_id, state);
  await remove("outbox", event.seq);
  await dropEarlier(event);
}

function phaseOf(kind: EventKind): Phase | null {
  if (kind === "before_photos") return "before";
  if (kind === "after_photos") return "after";
  return null;
}

/** Sends one event, a photograph set's photographs first. Null once it has landed. */
async function send(event: Queued): Promise<Verdict | null> {
  const phase = phaseOf(event.kind);
  if (phase !== null) {
    const trouble = await uploadFrames(event, phase);
    // A photograph the API would not take is the set's refusal, whatever its code for the file.
    if (trouble?.kind === "refused") return { ...trouble, note: "photo_rejected", fields: [] };
    if (trouble !== null) return trouble;
  }
  const answer = await api.send<unknown>(event.path, event.body ?? undefined, {
    eventId: event.id,
    startsAt: event.starts_at ?? null,
  });
  if (!answer.ok) return classify(answer);
  await landed(event, answer.body);
  return null;
}

async function run(): Promise<Replayed> {
  const round = { sent: 0, superseded: 0, refused: 0 };
  for (;;) {
    const event = nextToSend(await events());
    if (event === null) return { ...round, stopped: null };

    const verdict = await send(event);
    if (verdict === null) round.sent += 1;
    else if (verdict.kind === "retry_later") return { ...round, stopped: "offline" };
    else if (verdict.kind === "signed_out") return { ...round, stopped: "signed-out" };
    else if (verdict.kind === "too_early") await keepEarly(event, verdict.code);
    else if (verdict.kind === "superseded") {
      await markAs({ event, state: "superseded", note: verdict.note, fields: verdict.fields, moved: verdict.moved });
      await readAgainIfMoved(event.job_id, verdict.fields);
      round.superseded += 1;
    } else {
      await giveUp(event, verdict);
      round.refused += 1;
    }
    changed();
  }
}
