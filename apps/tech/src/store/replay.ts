// What the outbox sends, and in what order. Kept apart from IndexedDB so the
// rules can be read and tested on their own (test/node/front-ends/tech-outbox.test.ts).
//
// The rules, from docs/decisions/0038-offline-writes.md and the technician boards:
//
//   - Events are replayed in the order the phone queued them, per job. One job
//     is never overtaken by a later event of its own, which is what lets the
//     API refuse a step sent before the one ahead of it.
//   - A job whose queue has stopped holds nothing back from the other jobs. A
//     close-out for the 9:30 job that ops superseded must not strand the 11:30.
//   - A `409 superseded` stops that job and keeps what changed, so the screen
//     says which field moved under the phone and never a generic error, and
//     for a job given to another technician, whom and when.
//   - A check-in or no-show the API refused as early is kept as early, so the
//     card can say so after a reload. It stops nothing and is not unsent work.
//   - A write the API fails at its end (a 5xx, a 429) waits longer each time,
//     and its job with it, while the other jobs go on. After MOST_TRIES, or a
//     day on the phone, it stops as stuck for the technician to send again.

import type { Moved } from "@maneman/web-kit/api";
import type { EventBody, EventKind } from "../routes.ts";

export type EventState = "waiting" | "superseded" | "refused" | "early";

/** The states that stop a job's queue until the technician deals with it. */
type Stopping = "superseded" | "refused";

const stops = (event: Queued): event is Queued & { readonly state: Stopping } =>
  event.state === "superseded" || event.state === "refused";

/** One write the phone queued, of its kind: `body` is that kind's (../routes.ts). */
export interface Queued<K extends EventKind = EventKind> {
  /** The outbox's own key, counting up: the order the phone queued them in. */
  readonly seq: number;
  /** The UUIDv7 sent as `X-Client-Event-Id`, which makes the write idempotent. */
  readonly id: string;
  readonly job_id: string;
  readonly kind: K;
  /** The route this event is sent to, from the API client's list. */
  readonly path: string;
  readonly body: EventBody<K>;
  readonly queued_at: number;
  /** The job's start as the phone held it, sent as `X-Job-Starts-At`. */
  readonly starts_at: string | null;
  readonly state: EventState;
  /** The API's code for what stopped this job: `superseded`, `out_of_order`, or why it was refused. */
  readonly note: string | null;
  /** On a supersede, the fields that changed under the phone; on a refusal, the fields it refused. */
  readonly fields: readonly string[];
  /** On a job given to another technician, whom and when, as the API said. */
  readonly moved: Moved | null;
  /** On a refusal, the API's ID for it, for the technician to quote. */
  readonly request_id: string | null;
  /** How often the API failed it at its end, and the earliest it goes again. */
  readonly attempts: number;
  readonly next_at: number | null;
}

/** The tries a write the API keeps failing gets before it stops as stuck, and the longest it waits between them. */
export const MOST_TRIES = 8;
const LONGEST_WAIT_MS = 30 * 60_000;
/** A write still failing a day after it was queued is stuck, however few its tries. */
export const STUCK_AFTER_MS = 24 * 60 * 60_000;

/** How long a write waits before its next try: half a minute, doubling each time, a fifth either way at random. */
export const waitBeforeTry = (attempts: number, jitter: number): number =>
  Math.round(Math.min(LONGEST_WAIT_MS, 30_000 * 2 ** Math.max(0, attempts - 1)) * (0.8 + 0.4 * jitter));

/** The earliest any write waiting out a failure goes again; null where none is waiting. */
export function nextTryAt(queue: readonly Queued[]): number | null {
  const times = queue.flatMap((event) =>
    event.state === "waiting" && typeof event.next_at === "number" ? [event.next_at] : [],
  );
  return times.length === 0 ? null : Math.min(...times);
}

const inOrder = (queue: readonly Queued[]): Queued[] => [...queue].sort((a, b) => a.seq - b.seq);

/** The jobs whose queue has stopped: nothing more of theirs is sent until the technician deals with it. */
export function stoppedJobs(queue: readonly Queued[]): ReadonlySet<string> {
  return new Set(queue.filter(stops).map((event) => event.job_id));
}

/** The jobs whose next write is waiting out a failure: nothing of theirs goes before it may. */
function restingJobs(queue: readonly Queued[], now: number): ReadonlySet<string> {
  return new Set(
    queue
      .filter((event) => event.state === "waiting" && typeof event.next_at === "number" && event.next_at > now)
      .map((event) => event.job_id),
  );
}

/** Every event that may go now, oldest first, with each stopped job's events, and each resting job's, left out. */
export function sendable(queue: readonly Queued[], now = Date.now()): Queued[] {
  const stopped = stoppedJobs(queue);
  const resting = restingJobs(queue, now);
  return inOrder(queue).filter(
    (event) => event.state === "waiting" && !stopped.has(event.job_id) && !resting.has(event.job_id),
  );
}

/** The next event to send, or null when the queue is empty or every job in it has stopped or is resting. */
export function nextToSend(queue: readonly Queued[], now = Date.now()): Queued | null {
  return sendable(queue, now)[0] ?? null;
}

export interface JobAccount {
  readonly job_id: string;
  /** How many of this job's writes have not reached us. */
  readonly waiting: number;
  /** Set when the job's queue stopped: the write it stopped at, the API's code, and the fields behind it. */
  readonly stopped: {
    readonly kind: EventKind;
    readonly state: Stopping;
    readonly note: string | null;
    readonly fields: readonly string[];
    readonly moved: Moved | null;
    readonly requestId: string | null;
    /** The job's start as the phone held it when the write was queued. */
    readonly startsAt: string | null;
  } | null;
}

/**
 * The plain account the screens show of what has not yet reached us: one line
 * per job, oldest first, and the reason a job's queue has stopped.
 */
export function account(queue: readonly Queued[]): JobAccount[] {
  const accounts = new Map<string, { waiting: number; stopped: JobAccount["stopped"] }>();
  for (const event of inOrder(queue)) {
    const held = accounts.get(event.job_id) ?? { waiting: 0, stopped: null };
    if (event.state === "early") continue;
    if (event.state === "waiting") held.waiting += 1;
    else if (stops(event)) {
      held.stopped ??= {
        kind: event.kind,
        state: event.state,
        note: event.note,
        fields: event.fields,
        moved: event.moved ?? null,
        requestId: event.request_id ?? null,
        startsAt: event.starts_at ?? null,
      };
    }
    accounts.set(event.job_id, held);
  }
  return [...accounts].map(([job_id, held]) => ({ job_id, ...held }));
}

const refusedEarly = (queue: readonly Queued[], jobId: string, kind: EventKind): boolean =>
  queue.some((event) => event.job_id === jobId && event.kind === kind && event.state === "early");

/** Whether the job's last no-show was refused as before the wait ran out, so the card says so and stays. */
export const refusedAsEarly = (queue: readonly Queued[], jobId: string): boolean =>
  refusedEarly(queue, jobId, "no_show");

/** Whether the job's last check-in was refused as before the earliest check-in, so the card says when it opens. */
export const checkInRefusedAsEarly = (queue: readonly Queued[], jobId: string): boolean =>
  refusedEarly(queue, jobId, "check_in");
