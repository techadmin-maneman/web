// The technician app's outbox, landing on the server
// (docs/decisions/0038-offline-writes.md).
//
// "Offline writes from the technician app are queued on the device with a
// client-generated ID, and sent in order when the phone is back online. The
// server makes each write idempotent on that ID before passing it to FSM." The
// ID is unique per job, so a phone that replays its outbox lands each event
// once and gets the first answer back.
//
// "If FSM has changed underneath (for example ops reassigned the job while the
// phone was offline), the write is rejected with 409 superseded. The technician
// sees what changed. Nothing is merged silently." The rejection is recorded as
// an event too, marked superseded, so the record says the phone tried. A job
// moved to another time is superseded like one given to another technician.
//
// An event's time is the phone's, held within bounds (src/policy/phone-clock.ts),
// so a job worked offline keeps its real durations; received_at is ours.

import { isNoShow, stepBefore, type JobEventKind } from "../policy/in-job-steps.ts";
import { onTheVisitsDay } from "../policy/phone-clock.ts";
import type { WorkableJob } from "./tech-jobs.ts";

export type FsmWriteState = "pending" | "written" | "rejected";

const EVENT_COLUMNS = "id, appointment_id, event_id, kind, body, occurred_at, fsm_write_state, superseded";

export interface JobEvent {
  readonly id: string;
  readonly appointmentId: string;
  readonly eventId: string;
  readonly kind: JobEventKind;
  readonly body: Record<string, unknown>;
  readonly occurredAt: string;
  readonly fsmWriteState: FsmWriteState;
  readonly superseded: boolean;
}

/** What the server did with an event the phone sent. */
export type Landing =
  | { readonly kind: "landed"; readonly event: JobEvent; readonly replayed: boolean }
  /** FSM moved the job under the phone; the fields that changed, never their values. */
  | { readonly kind: "superseded"; readonly changed: readonly string[] }
  /** A step sent before the one ahead of it; the app sends its outbox in order. */
  | { readonly kind: "out_of_order"; readonly needs: JobEventKind }
  /** A check-in or a start on a day that is not the job's own. */
  | { readonly kind: "not_today" }
  /** A no-show on a job already started: the client was home. */
  | { readonly kind: "already_started" };

export interface EventInput {
  readonly job: WorkableJob;
  readonly technicianId: string;
  readonly deviceRowId: string;
  readonly eventId: string;
  readonly kind: JobEventKind;
  readonly body: Record<string, unknown>;
  /** The phone's time for it, within bounds. */
  readonly occurredAt: Date;
  /** The job's start as the phone holds it, when the phone says; a different one means ops moved it. */
  readonly expectedStart: Date | null;
  readonly now: Date;
}

/**
 * Records one event of the phone's outbox, once. A replay of an ID this job
 * already holds changes nothing and comes back as the event that landed first.
 */
export async function landJobEvent(db: D1Database, input: EventInput): Promise<Landing> {
  const held = await eventByClientId(db, input.job.id, input.eventId);
  if (held !== null) return { kind: "landed", event: held, replayed: true };

  const changed = supersededBy(input.job, input.technicianId, input.expectedStart);
  if (changed.length > 0) {
    await record(db, input, { superseded: true });
    return { kind: "superseded", changed };
  }

  const startsTheDay = input.kind === "check_in" || input.kind === "start";
  if (startsTheDay && !onTheVisitsDay(input.occurredAt, input.job.windowStart)) return { kind: "not_today" };

  const done = await kindsLanded(db, input.job.id);
  if (isNoShow(input.kind, input.body) && done.has("start")) return { kind: "already_started" };
  const needs = stepBefore(input.kind, input.job.type, done, input.body);
  if (needs !== null) return { kind: "out_of_order", needs };

  const written = await record(db, input, { superseded: false });
  if (written !== null) return { kind: "landed", event: written, replayed: false };

  // A second call with the same ID at the same moment lost the insert: answer with the row that won.
  const raced = await eventByClientId(db, input.job.id, input.eventId);
  if (raced === null) throw new Error("the job event was not written");
  return { kind: "landed", event: raced, replayed: true };
}

/** What FSM changed under the phone, by field name. Empty when nothing did. */
function supersededBy(job: WorkableJob, technicianId: string, expectedStart: Date | null): string[] {
  const changed: string[] = [];
  if (job.technicianId !== technicianId) changed.push("technician");
  if (job.status === "cancelled" || job.status === "terminated") changed.push("status");
  if (expectedStart !== null && expectedStart.getTime() !== job.windowStart.getTime()) changed.push("time");
  return changed;
}

async function kindsLanded(db: D1Database, appointmentId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT kind FROM job_events WHERE appointment_id = ?1 AND superseded = 0")
    .bind(appointmentId)
    .all<{ kind: string }>();
  return new Set(results.map((row) => row.kind));
}

export async function eventByClientId(
  db: D1Database,
  appointmentId: string,
  eventId: string,
): Promise<JobEvent | null> {
  const row = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM job_events
       WHERE appointment_id = ?1 AND event_id = ?2`,
    )
    .bind(appointmentId, eventId)
    .first<EventRow>();
  return row === null ? null : eventOf(row);
}

export async function eventById(db: D1Database, id: string): Promise<JobEvent | null> {
  const row = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM job_events
       WHERE id = ?1`,
    )
    .bind(id)
    .first<EventRow>();
  return row === null ? null : eventOf(row);
}

/** Every event of a job that landed, oldest first: what the FSM write is composed from. */
export async function eventsOf(db: D1Database, appointmentId: string): Promise<JobEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM job_events
       WHERE appointment_id = ?1 AND superseded = 0 ORDER BY received_at, rowid`,
    )
    .bind(appointmentId)
    .all<EventRow>();
  return results.map(eventOf);
}

// A job's events in the order they landed: by our clock, then by the order the
// rows were written, since two can land in the same millisecond.
const LANDED_BEFORE = "(received_at, rowid) < (SELECT received_at, rowid FROM job_events WHERE id = ?2)";
const LANDED_AFTER = "(received_at, rowid) > (SELECT received_at, rowid FROM job_events WHERE id = ?2)";

/**
 * The earliest event of the same job that landed before this one and is not
 * yet written to FSM: what this one must wait for, or must not overtake.
 */
export async function unwrittenBefore(db: D1Database, event: JobEvent): Promise<JobEvent | null> {
  const row = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM job_events
       WHERE appointment_id = ?1 AND superseded = 0 AND fsm_write_state <> 'written' AND ${LANDED_BEFORE}
       ORDER BY received_at, rowid LIMIT 1`,
    )
    .bind(event.appointmentId, event.id)
    .first<EventRow>();
  return row === null ? null : eventOf(row);
}

/** The job's next event still waiting for FSM, after this one. */
export async function nextPending(db: D1Database, event: JobEvent): Promise<JobEvent | null> {
  const row = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM job_events
       WHERE appointment_id = ?1 AND superseded = 0 AND fsm_write_state = 'pending' AND ${LANDED_AFTER}
       ORDER BY received_at, rowid LIMIT 1`,
    )
    .bind(event.appointmentId, event.id)
    .first<EventRow>();
  return row === null ? null : eventOf(row);
}

/**
 * Gives up on every event of the job still waiting behind this one, which will
 * never be written now that it was not. Returns their kinds, in order, for ops.
 */
export async function rejectPendingAfter(
  db: D1Database,
  event: JobEvent,
  now: Date,
  reason: string,
): Promise<JobEventKind[]> {
  const { results } = await db
    .prepare(
      `UPDATE job_events SET fsm_write_state = 'rejected', fsm_error = ?3, updated_at = ?4
       WHERE appointment_id = ?1 AND superseded = 0 AND fsm_write_state = 'pending' AND ${LANDED_AFTER}
       RETURNING kind, received_at, rowid`,
    )
    .bind(event.appointmentId, event.id, reason, now.toISOString())
    .all<{ kind: JobEventKind; received_at: string; rowid: number }>();
  return results.sort((a, b) => a.received_at.localeCompare(b.received_at) || a.rowid - b.rowid).map((row) => row.kind);
}

/** Marks what FSM did with the event. A rejection keeps FSM's status and message, never record data. */
export async function markFsmWrite(
  db: D1Database,
  id: string,
  state: FsmWriteState,
  now: Date,
  error: string | null = null,
): Promise<void> {
  await db
    .prepare("UPDATE job_events SET fsm_write_state = ?2, fsm_error = ?3, updated_at = ?4 WHERE id = ?1")
    .bind(id, state, error, now.toISOString())
    .run();
}

interface EventRow {
  id: string;
  appointment_id: string;
  event_id: string;
  kind: JobEventKind;
  body: string;
  occurred_at: string;
  fsm_write_state: FsmWriteState;
  superseded: number;
}

function eventOf(row: EventRow): JobEvent {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    eventId: row.event_id,
    kind: row.kind,
    body: JSON.parse(row.body) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    fsmWriteState: row.fsm_write_state,
    superseded: row.superseded === 1,
  };
}

async function record(db: D1Database, input: EventInput, options: { superseded: boolean }): Promise<JobEvent | null> {
  const at = input.now.toISOString();
  const row = await db
    .prepare(
      `INSERT INTO job_events
         (id, appointment_id, event_id, technician_id, device_id, kind, body, occurred_at, received_at,
          fsm_write_state, superseded, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?9)
       ON CONFLICT (appointment_id, event_id) DO NOTHING
       RETURNING ${EVENT_COLUMNS}`,
    )
    .bind(
      crypto.randomUUID(),
      input.job.id,
      input.eventId,
      input.technicianId,
      input.deviceRowId,
      input.kind,
      JSON.stringify(input.body),
      input.occurredAt.toISOString(),
      at,
      // A superseded write reaches FSM never; it is kept only as the record that the phone tried.
      options.superseded ? "rejected" : "pending",
      options.superseded ? 1 : 0,
    )
    .first<EventRow>();
  return row === null ? null : eventOf(row);
}
