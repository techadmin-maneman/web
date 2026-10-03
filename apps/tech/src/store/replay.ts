// What the outbox sends, and in what order. Kept apart from IndexedDB so the
// rules can be read and tested on their own (test/node/tech-outbox.test.ts).
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

import type { Moved } from "@maneman/web-kit/api";
import type { EventKind } from "../routes.ts";

export type { EventKind };

export type EventState = "waiting" | "superseded" | "refused";

export interface Queued {
  /** The outbox's own key, counting up: the order the phone queued them in. */
  readonly seq: number;
  /** The UUIDv7 sent as `X-Client-Event-Id`, which makes the write idempotent. */
  readonly id: string;
  readonly job_id: string;
  readonly kind: EventKind;
  /** The route this event is sent to, from the API client's list. */
  readonly path: string;
  readonly body: unknown;
  readonly queued_at: number;
  /** The job's start as the phone held it, sent as `X-Job-Starts-At`. Absent on what an older build queued. */
  readonly starts_at?: string | null;
  readonly state: EventState;
  /** The API's code for what stopped this job: `superseded`, `out_of_order`, or why it was refused. */
  readonly note: string | null;
  /** On a supersede, the fields that changed under the phone; on a refusal, the fields it refused. */
  readonly fields: readonly string[];
  /** On a job given to another technician, whom and when, as the API said. Absent on what an older build kept. */
  readonly moved?: Moved | null;
  /** On a refusal, the API's ID for it, for the technician to quote. Absent on what an older build kept. */
  readonly request_id?: string | null;
}

const inOrder = (queue: readonly Queued[]): Queued[] => [...queue].sort((a, b) => a.seq - b.seq);

/** The jobs whose queue has stopped: nothing more of theirs is sent until the technician deals with it. */
export function stoppedJobs(queue: readonly Queued[]): ReadonlySet<string> {
  return new Set(queue.filter((event) => event.state !== "waiting").map((event) => event.job_id));
}

/** Every event that may go now, oldest first, with each stopped job's events left out. */
export function sendable(queue: readonly Queued[]): Queued[] {
  const stopped = stoppedJobs(queue);
  return inOrder(queue).filter((event) => event.state === "waiting" && !stopped.has(event.job_id));
}

/** The next event to send, or null when the queue is empty or every job in it has stopped. */
export function nextToSend(queue: readonly Queued[]): Queued | null {
  return sendable(queue)[0] ?? null;
}

export interface JobAccount {
  readonly job_id: string;
  /** How many of this job's writes have not reached us. */
  readonly waiting: number;
  /** Set when the job's queue stopped: the write it stopped at, the API's code, and the fields behind it. */
  readonly stopped: {
    readonly kind: EventKind;
    readonly state: Exclude<EventState, "waiting">;
    readonly note: string | null;
    readonly fields: readonly string[];
    readonly moved: Moved | null;
    readonly requestId: string | null;
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
    if (event.state === "waiting") held.waiting += 1;
    else {
      held.stopped ??= {
        kind: event.kind,
        state: event.state,
        note: event.note,
        fields: event.fields,
        moved: event.moved ?? null,
        requestId: event.request_id ?? null,
      };
    }
    accounts.set(event.job_id, held);
  }
  return [...accounts].map(([job_id, held]) => ({ job_id, ...held }));
}
