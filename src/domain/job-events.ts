// The technician app's outbox, landing on the server
// (docs/decisions/0038-offline-writes.md).
//
// "Offline writes from the technician app are queued on the device with a
// client-generated ID, and sent in order when the phone is back online. The
// server makes each write idempotent on that ID before passing it to FSM." The
// ID is unique per job, so a phone that replays its outbox lands each event
// once and gets the first answer back: the event that landed, or the refusal of
// one that was superseded.
//
// "If FSM has changed underneath (for example ops reassigned the job while the
// phone was offline), the write is rejected with 409 superseded. The technician
// sees what changed. Nothing is merged silently." The rejection is recorded as
// an event too, marked superseded, so the record says the phone tried. A job
// moved to another time is superseded like one given to another technician, and
// one given to another technician names them to the phone, by first name, with
// when ops moved it (src/policy/job-visibility.ts).
//
// An event's time is the phone's, held within bounds (src/policy/phone-clock.ts),
// so a job worked offline keeps its real durations; received_at is ours.
//
// Where our own database holds the record of field work, nothing waits for FSM:
// what the step records is written in the event's own batch (src/domain/job-record.ts).

import { firstNameOf } from "../lib/names.ts";
import { isNoShow, landsAfterClose, stepBefore, type JobEventKind } from "../policy/in-job-steps.ts";
import { namesTheOtherTechnician } from "../policy/job-visibility.ts";
import { earliestCheckIn, onTheVisitsDay, tooEarlyToArrive, type PhoneClock } from "../policy/phone-clock.ts";
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

/** The technician a job went to, by first name, and when ops moved it there: null when it was moved in FSM itself. */
export interface MovedTo {
  readonly technician: string;
  readonly at: string | null;
}

/** What changed under the phone, by field name, and whom the job went to where that is to be said. */
export interface Superseding {
  readonly changed: readonly string[];
  readonly moved: MovedTo | null;
}

/** What the server did with an event the phone sent. */
export type Landing =
  | { readonly kind: "landed"; readonly event: JobEvent; readonly replayed: boolean }
  /** FSM moved the job under the phone. */
  | ({ readonly kind: "superseded" } & Superseding)
  /** A step sent before the one ahead of it; the app sends its outbox in order. */
  | { readonly kind: "out_of_order"; readonly needs: JobEventKind }
  /** A check-in or a start on a day that is not the job's own. */
  | { readonly kind: "not_today" }
  /** A check-in or a start before the earliest check-in, which it names. */
  | { readonly kind: "too_early"; readonly earliest: Date }
  /** A no-show on a job already started: the client was home. */
  | { readonly kind: "already_started" }
  /** A step on a job that has closed, other than a correction it still takes. */
  | { readonly kind: "already_closed" };

/** A write as the phone sent it. */
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
  /** How long before the booked start a technician may check in, as ops set it. */
  readonly phoneClock: PhoneClock;
}

/** A write that may land, with where its work is recorded. */
export interface LandingInput extends EventInput {
  /** Where the step's work is recorded once it lands (src/config/field-record.ts). */
  readonly recordedIn: StepRecord;
  /** Written in the event's own batch whoever holds the record, and only if the event lands: a check-in's own row. */
  readonly withEvent?: readonly D1PreparedStatement[];
}

/**
 * FSM's queue, which writes the step to FSM after it lands; or our own database, whose statements for it
 * (src/domain/job-record.ts) are written in the event's own batch.
 */
export type StepRecord =
  { readonly holder: "fsm" } | { readonly holder: "ours"; readonly statements: readonly D1PreparedStatement[] };

/**
 * Records one event of the phone's outbox, once. A replay of an ID this job
 * already holds changes nothing and is answered as it was the first time.
 */
export async function landJobEvent(db: D1Database, input: LandingInput): Promise<Landing> {
  const answered = await answerBeforeLanding(db, input);
  if (answered !== null) return answered;
  return landInOrder(db, input);
}

/**
 * What a write is answered with before anything of it is measured or lands: a replay, as it was answered the first
 * time; the refusal of a job that changed under the phone, which records that the phone tried; of a job that has
 * closed; or of a check-in or a start on a day that is not the job's own, or before the earliest check-in. Null when
 * the write may go on to land.
 */
export async function answerBeforeLanding(db: D1Database, input: EventInput): Promise<Landing | null> {
  const held = await eventByClientId(db, input.job.id, input.eventId);
  if (held !== null) return replayOf(db, held, input);

  const superseding = await whatChanged(db, input.job, input.technicianId, input.expectedStart);
  if (superseding.changed.length > 0) {
    await recordSuperseded(db, input);
    return { kind: "superseded", ...superseding };
  }

  const closed = await closedAt(db, input.job.id);
  if (closed !== null && !landsAfterClose(input.kind, closed, input.now)) return { kind: "already_closed" };

  const startsTheDay = input.kind === "check_in" || input.kind === "start";
  if (startsTheDay && !onTheVisitsDay(input.occurredAt, input.job.windowStart)) return { kind: "not_today" };
  if (startsTheDay && tooEarlyToArrive(input.now, input.job.windowStart, input.phoneClock)) {
    return { kind: "too_early", earliest: earliestCheckIn(input.job.windowStart, input.phoneClock) };
  }
  return null;
}

/** A write sent again: the event that landed, or, for one superseded then or since, what changed under the phone. */
async function replayOf(db: D1Database, held: JobEvent, input: EventInput): Promise<Landing> {
  if (!held.superseded) return { kind: "landed", event: held, replayed: true };
  return { kind: "superseded", ...(await whatChanged(db, input.job, input.technicianId, input.expectedStart)) };
}

/** Lands a write answerBeforeLanding let through: refused before a step it needs, else recorded once. */
export async function landInOrder(db: D1Database, input: LandingInput): Promise<Landing> {
  const done = await kindsLanded(db, input.job.id);
  if (isNoShow(input.kind, input.body) && done.has("start")) return { kind: "already_started" };
  const needs = stepBefore(input.kind, input.job.type, done, input.body, input.job.oneVisit !== null);
  if (needs !== null) return { kind: "out_of_order", needs };

  const written = await record(db, input);
  if (written !== null) return { kind: "landed", event: written, replayed: false };

  // A second call with the same ID at the same moment lost the insert: answer with the row that won.
  const raced = await eventByClientId(db, input.job.id, input.eventId);
  if (raced === null) throw new Error("the job event was not written");
  return { kind: "landed", event: raced, replayed: true };
}

/**
 * What FSM changed under a phone that holds the job as it was: none of it when
 * nothing did. `expectedStart` is the start the phone holds, when it says.
 */
export async function whatChanged(
  db: D1Database,
  job: WorkableJob,
  technicianId: string,
  expectedStart: Date | null,
): Promise<Superseding> {
  const changed = supersededBy(job, technicianId, expectedStart);
  const moved = namesTheOtherTechnician(changed) ? await movedTo(db, job) : null;
  return { changed, moved };
}

/**
 * Whether a job is, or was, this technician's: it is theirs now, a step of
 * theirs landed on it, or ops moved it from them. Only then is what changed on
 * it theirs to hear.
 */
export async function wasTheirs(db: D1Database, job: WorkableJob, technicianId: string): Promise<boolean> {
  if (job.technicianId === technicianId) return true;
  const row = await db
    .prepare(
      `SELECT 1 FROM job_events WHERE appointment_id = ?1 AND technician_id = ?2 AND superseded = 0
       UNION ALL
       SELECT 1 FROM dispatch_moves WHERE appointment_id = ?1 AND was_technician_id = ?2
       LIMIT 1`,
    )
    .bind(job.id, technicianId)
    .first();
  return row !== null;
}

/** What FSM changed under the phone, by field name, a cancellation first. Empty when nothing did. */
function supersededBy(job: WorkableJob, technicianId: string, expectedStart: Date | null): string[] {
  const changed: string[] = [];
  if (job.status === "cancelled" || job.status === "terminated") changed.push("status");
  if (job.technicianId !== technicianId) changed.push("technician");
  if (expectedStart !== null && expectedStart.getTime() !== job.windowStart.getTime()) changed.push("time");
  return changed;
}

/**
 * The technician the job is with now, by first name, and when the dispatch
 * board last moved it to them. A move made in FSM itself leaves no row of ours,
 * so it has no time.
 */
async function movedTo(db: D1Database, job: WorkableJob): Promise<MovedTo | null> {
  const row = await db
    .prepare(
      `SELECT t.name,
         (SELECT m.created_at FROM dispatch_moves m
          WHERE m.appointment_id = ?1 AND m.now_technician_id = t.id
          ORDER BY m.created_at DESC LIMIT 1) AS moved_at
       FROM technicians t WHERE t.id = ?2`,
    )
    .bind(job.id, job.technicianId)
    .first<{ name: string; moved_at: string | null }>();
  if (row === null) return null;
  const technician = firstNameOf(row.name);
  return technician === "" ? null : { technician, at: row.moved_at };
}

/** When the job closed: its first outcome to land, or ops closing it by hand. Null while it is open. */
export async function closedAt(db: D1Database, appointmentId: string): Promise<Date | null> {
  const row = await db
    .prepare(
      `SELECT MIN(at) AS closed_at FROM (
         SELECT received_at AS at FROM job_events WHERE appointment_id = ?1 AND kind = 'outcome' AND superseded = 0
         UNION ALL
         SELECT updated_at AS at FROM visits WHERE appointment_id = ?1 AND closed_by IS NOT NULL
       )`,
    )
    .bind(appointmentId)
    .first<{ closed_at: string | null }>();
  const closed = row?.closed_at ?? null;
  return closed === null ? null : new Date(closed);
}

/** The kinds of event a job holds, superseded ones aside. */
export async function kindsLanded(db: D1Database, appointmentId: string): Promise<Set<string>> {
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

/** Gives up on every event of the visit still waiting for FSM. Returns their IDs. */
export async function rejectAllPending(
  db: D1Database,
  appointmentId: string,
  now: Date,
  reason: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `UPDATE job_events SET fsm_write_state = 'rejected', fsm_error = ?2, updated_at = ?3
       WHERE appointment_id = ?1 AND superseded = 0 AND fsm_write_state = 'pending'
       RETURNING id`,
    )
    .bind(appointmentId, reason, now.toISOString())
    .all<{ id: string }>();
  return results.map((row) => row.id);
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

/**
 * Writes the event in one batch with what is written with it, and, where our own database holds the record, what the
 * step records there. Null when the same event ID landed first.
 */
async function record(db: D1Database, input: LandingInput): Promise<JobEvent | null> {
  const ours = input.recordedIn.holder === "ours" ? input.recordedIn.statements : [];
  const [inserted] = await db.batch<EventRow>([
    eventStatement(db, input, writeStateOf(input.recordedIn), false),
    ...(input.withEvent ?? []),
    ...ours,
  ]);
  const row = inserted?.results[0];
  return row === undefined ? null : eventOf(row);
}

/** A superseded write records nothing and never reaches FSM: it is kept only as the record that the phone tried. */
async function recordSuperseded(db: D1Database, input: EventInput): Promise<void> {
  await eventStatement(db, input, "rejected", true).run();
}

/** A step our own database records is written with the event; one FSM holds waits for FSM's queue. */
function writeStateOf(recordedIn: StepRecord): FsmWriteState {
  return recordedIn.holder === "ours" ? "written" : "pending";
}

function eventStatement(
  db: D1Database,
  input: EventInput,
  state: FsmWriteState,
  superseded: boolean,
): D1PreparedStatement {
  return db
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
      input.now.toISOString(),
      state,
      superseded ? 1 : 0,
    );
}
