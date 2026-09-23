// What the outbox sends, and in what order. Kept apart from IndexedDB so the
// rules can be read and tested on their own (test/node/tech-outbox.test.ts).
//
// The rules, from docs/prompts/phase2-backend.md and the technician boards:
//
//   - Events are replayed in the order the phone queued them, per job. One job
//     is never overtaken by a later event of its own.
//   - A job whose queue has stopped holds nothing back from the other jobs. A
//     close-out for the 9:30 job that ops superseded must not strand the 11:30.
//   - A `409 superseded` stops that job and keeps what changed, so the screen
//     says "Ops moved this job to Sandeep at 10:40" and never a generic error.

/** The writes the app queues. Each name is a route in P2-M4 (apps/tech/src/api.ts). */
export type EventKind = "checkin" | "start" | "photos" | "checklist" | "consumables" | "piece" | "outcome" | "no-show";

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
  readonly state: EventState;
  /** What changed under the phone, from a 409; or why the API refused the write. */
  readonly note: string | null;
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
  /** Set when the job's queue stopped: what changed, or why it was refused. */
  readonly stopped: { readonly state: Exclude<EventState, "waiting">; readonly note: string | null } | null;
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
    else held.stopped ??= { state: event.state, note: event.note };
    accounts.set(event.job_id, held);
  }
  return [...accounts].map(([job_id, held]) => ({ job_id, ...held }));
}
