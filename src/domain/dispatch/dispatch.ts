// The two writes ops make on the dispatch board: a move, and the room one needs
// (src/policy/dispatch.ts, docs/decisions/0069-dispatch-under-concurrency.md).
// The board itself is dispatch-board.ts.
//
// The clash check is the same one self-serve booking runs, so the two cannot
// disagree (docs/decisions/0034-clash-check.md). A job is as long as its
// service, or as its booked window where that is longer, and is placed and
// moved by that length (docs/decisions/0085-services-ops-can-edit.md).
//
// "A technician cannot hold two live jobs in one window on one date": the
// refusal below happens before anything is written. A technician on leave is
// refused the same way, and named as away rather than busy (ADR 0062); a free
// window with no room for the visit is named as that. A move is one batch: its
// claim on the new time, the visit and the client's message. "The client's
// payment carries over and they are never charged for a move ops make", so no
// amount is read or written here at all: a visit carries a badge, never a
// figure. A visit the technician has begun is not moved, unless they have only
// checked in and ops, warned, choose to clear their check-in: they check in again
// at the new time. Nor is a visit whose client has paid for a move, or booked
// one free, that waits to be booked: ops are told it is being moved.

import { failedNotNullOn, failedUniqueOn } from "../../lib/d1-errors.ts";
import { BOOKING_WINDOWS, type BookingWindow } from "../../config/scheduling.ts";
import { indiaDate } from "../../lib/india-time.ts";
import {
  clientNotice,
  keepsTheClientsNotice,
  type ClientNotice,
  type MoveReason,
  type MoveRefusal,
} from "../../policy/dispatch.ts";
import { unitsFor } from "../../policy/visit-length.ts";
import { auditStatement, type AuditEntry } from "../ops/audit.ts";
import { activeTechnicians, bookedMinutes, claimsOf, loadBlackouts, occupancy } from "../booking/occupancy.ts";
import { breaksRotation, visitsOfClient } from "../booking/technician-rotation.ts";
import { releaseDeadHolds } from "../booking/hold-slot.ts";
import { begunPastArrival, visitBegun } from "../visits/visit-begun.ts";
import { visitMessage } from "../messages/visit-messages.ts";
import { loadSlotSchedule } from "../booking/slot-times.ts";
import { statusIn, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import { LATEST_VISITS_CONSENT, weekFrom, UNTOLD_MOVE } from "./dispatch-board.ts";
import {
  type LiveJob,
  liveJob,
  mayMove,
  targetOf,
  isWhereItIs,
  movesOntoBlackout,
  isUnderWay,
  CLIENT_MOVING,
  timesAt,
  landingOf,
} from "./dispatch-landing.ts";

export interface MoveInput {
  readonly appointmentId: string;
  /** The technician it goes to; absent keeps the one it has. */
  readonly technicianId?: string | null;
  /** The India date and window it goes to; absent keeps the time it has. */
  readonly date?: string | null;
  readonly window?: BookingWindow | null;
  readonly reason: MoveReason;
  /** The Access identity that made the move (ADR 0031). */
  readonly actor: string;
  /** The job as the board the move was made from showed it: its technician, none in the tray, and its start. */
  readonly expected: { readonly technicianId: string | null; readonly startsAt: string };
  /**
   * Set when ops, warned that the technician has checked in, move the visit anyway: their check-in is cleared, and this
   * entry records who chose it. Absent for an ordinary move.
   */
  readonly clearCheckIn?: AuditEntry | null;
  /** Why ops move the visit onto a day they blacked out, as they typed it; absent for any other day. */
  readonly blackoutReason?: string | null;
}

/**
 * What changed under a board since it was loaded: the job's technician, its
 * time, or another move of it still being written.
 */
type Change = "technician" | "time" | "moving";

type MoveOutcome =
  | { readonly kind: "moved"; readonly moveId: string; readonly clientNotice: ClientNotice }
  | { readonly kind: "refused"; readonly reason: MoveRefusal }
  | { readonly kind: "not_found" }
  /** A job in the tray, sent with no technician to put it on. */
  | { readonly kind: "no_technician" }
  /** The board the move was made from no longer shows the job as it is; nothing was written. */
  | { readonly kind: "superseded"; readonly changed: readonly Change[] }
  /** The move names the technician, day and window the job already has. */
  | { readonly kind: "nothing_to_move" }
  /** The technician has begun the visit, so it stays where it is; nothing was written. */
  | { readonly kind: "in_progress" };

interface MoveDeps {
  /** Queues the client's "your visit is now …" message. */
  readonly notify?: (messageId: string) => Promise<unknown>;
}

/** A move that passed its checks: the job, where it goes, and the time it claims there. */
interface PlannedMove {
  readonly id: string;
  readonly job: LiveJob;
  readonly technicianId: string;
  readonly reason: MoveReason;
  /** The Access identity that made the move (ADR 0031). */
  readonly actor: string;
  /** When the visit starts and ends once moved. */
  readonly start: Date;
  readonly end: Date;
  /** Only the technician changes. */
  readonly keepsTime: boolean;
  /** The India date of the technician's day the move claims, and its half-slots there. */
  readonly date: string;
  readonly claims: readonly string[];
  /** The audit entry for clearing the technician's check-in; null when they had not checked in. */
  readonly clearCheckIn: AuditEntry | null;
  /** Why ops moved it onto a day they blacked out; null for any other day. */
  readonly blackoutReason: string | null;
}

/**
 * Assigns or moves one job: the checks, then the move written. Assigning and moving are the same write; only what the
 * caller changes differs.
 */
export async function moveJob(db: D1Database, deps: MoveDeps, input: MoveInput, now: Date): Promise<MoveOutcome> {
  const job = await liveJob(db, input.appointmentId);
  if (job === null) return { kind: "not_found" };
  const changed = changedSince(job, input.expected);
  if (changed.length > 0) return { kind: "superseded", changed };
  if (job.client_moving === 1) return { kind: "superseded", changed: ["moving"] };
  const clearCheckIn = input.clearCheckIn ?? null;
  if (!mayMove({ job, clearingCheckIn: clearCheckIn !== null })) return { kind: "in_progress" };

  const wasStart = new Date(job.window_start);
  const technicianId = input.technicianId ?? job.technician_id;
  if (technicianId === null) return { kind: "no_technician" };
  const schedule = await loadSlotSchedule(db);
  // What ops left out keeps what the job has.
  const date = input.date ?? indiaDate(wasStart);
  const window = input.window ?? schedule.at(wasStart).window;
  const target = targetOf({ job, technicianId, place: { date, window }, schedule, now });
  if (isWhereItIs(job, target)) return { kind: "nothing_to_move" };

  // The check runs before anything is written. The job's own time does not
  // count against its own move.
  const [held, ontoBlackout, clientVisits] = await Promise.all([
    occupancy({ db, from: date, to: date, now, exceptVisitId: job.id }),
    movesOntoBlackout(db, job, date),
    visitsOfClient(db, job.person_id, job.id),
  ]);
  const blackoutReason = ontoBlackout ? (input.blackoutReason ?? null) : null;
  const placing = { minutes: bookedMinutes(job), start: wasStart };
  const beside = breaksRotation(clientVisits, { technicianId: job.technician_id, date: indiaDate(wasStart) }, target);
  const landing = landingOf({
    day: held(technicianId, date),
    job: placing,
    target,
    blackoutWithoutReason: ontoBlackout && blackoutReason === null,
    beside,
  });
  if (landing.kind === "refused") return landing;

  const times = timesAt(target, landing.start, placing, schedule);
  const move: PlannedMove = {
    id: crypto.randomUUID(),
    job,
    technicianId,
    reason: input.reason,
    actor: input.actor,
    start: times.start,
    end: times.end,
    keepsTime: target.keepsTime,
    date,
    claims: claimsOf(landing.start, unitsFor(placing.minutes), window),
    clearCheckIn: isUnderWay(job) ? clearCheckIn : null,
    blackoutReason,
  };
  return writeMove(db, deps, move, now);
}

/**
 * Moves a job in one batch: the move, its claim on the new time, the visit and the client's message. The claim is the clash test: a hold or another move that took the time since it was checked fails the
 * batch. It is let go in the same batch, since the visit's own row now holds the time. A visit changed or begun since
 * it was read fails the batch as well, and nothing is written.
 */
async function writeMove(db: D1Database, deps: MoveDeps, move: PlannedMove, now: Date): Promise<MoveOutcome> {
  const at = now.toISOString();
  const told = await clientToldOf(db, move, now);
  try {
    await db.batch([
      ...releaseDeadHolds(db, now),
      // The message row is written before the move points at it.
      ...(told.message === null ? [] : [told.message.statement]),
      writtenMove(db, move, told.message?.id ?? null, at),
      ...move.claims.map((claim) => claimOf(db, move, claim)),
      movedVisit(db, move, at),
      releasingClaims(db, move.id),
      ...checkInCleared(db, move, now),
    ]);
  } catch (error) {
    if (failedUniqueOn(error, "slot_claims")) return { kind: "refused", reason: "clash" };
    if (failedNotNullOn(error, "dispatch_moves.appointment_id")) return changedUnder(db, move);
    throw error;
  }
  if (told.message !== null) await deps.notify?.(told.message.id);
  return { kind: "moved", moveId: move.id, clientNotice: told.notice };
}

/**
 * The move, recorded as written. It names its visit only while the visit is as the move read it, not yet begun, or
 * begun by no more than the check-in it clears, and no move of the client's waits on it; otherwise its visit is empty,
 * which the table refuses, and the batch it is in writes nothing.
 */
function writtenMove(db: D1Database, move: PlannedMove, messageId: string | null, at: string): D1PreparedStatement {
  const { job } = move;
  const begun = move.clearCheckIn === null ? visitBegun("a") : begunPastArrival("a");
  return db
    .prepare(
      `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
         reason, actor, fsm_write_state, message_id, created_at, updated_at, blackout_reason)
       VALUES (?1,
         (SELECT a.id FROM appointments a
          WHERE a.id = ?2 AND a.technician_id IS ?3 AND a.window_start = ?5 AND a.deleted_at IS NULL
            AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND NOT ${begun} AND NOT ${CLIENT_MOVING}),
         ?3, ?4, ?5, ?6, ?7, ?8, 'written', ?9, ?10, ?10, ?11)`,
    )
    .bind(
      move.id,
      job.id,
      job.technician_id,
      move.technicianId,
      job.window_start,
      move.start.toISOString(),
      move.reason,
      move.actor,
      messageId,
      at,
      move.blackoutReason,
    );
}

/** Why a move found its visit changed under it, read again as the checks before the write read it. */
async function changedUnder(db: D1Database, move: PlannedMove): Promise<MoveOutcome> {
  const job = await liveJob(db, move.job.id);
  if (job === null) return { kind: "not_found" };
  const changed = changedSince(job, { technicianId: move.job.technician_id, startsAt: move.job.window_start });
  if (changed.length > 0) return { kind: "superseded", changed };
  if (!mayMove({ job, clearingCheckIn: move.clearCheckIn !== null })) return { kind: "in_progress" };
  return { kind: "superseded", changed: ["moving"] };
}

/**
 * Clears the technician's check-in once the move is written: every step their phone landed on the visit is set aside,
 * the check-in all there is, so they check in again where the visit now is. The audit log names who chose it.
 */
function checkInCleared(db: D1Database, move: PlannedMove, now: Date): D1PreparedStatement[] {
  if (move.clearCheckIn === null) return [];
  const entry: AuditEntry = { ...move.clearCheckIn, detail: { move_id: move.id } };
  return [
    db
      .prepare("UPDATE job_events SET superseded = 1, updated_at = ?2 WHERE appointment_id = ?1 AND superseded = 0")
      .bind(move.job.id, now.toISOString()),
    auditStatement(db, entry, now),
  ];
}

/** The visit where the move puts it. */
function movedVisit(db: D1Database, move: PlannedMove, at: string): D1PreparedStatement {
  const { job } = move;
  return db
    .prepare(
      `UPDATE appointments SET technician_id = ?2, window_start = ?3, window_end = ?4, synced_at = ?5,
         start_before_move = ?6
       WHERE id = ?1`,
    )
    .bind(
      job.id,
      move.technicianId,
      move.start.toISOString(),
      move.end.toISOString(),
      at,
      move.keepsTime ? job.start_before_move : startBeforeMoving(job, move.reason),
    );
}

/** How the client hears of the move: the notice, and the message row where they are messaged. */
async function clientToldOf(
  db: D1Database,
  move: PlannedMove,
  now: Date,
): Promise<{ notice: ClientNotice; message: { id: string; statement: D1PreparedStatement } | null }> {
  const { job } = move;
  const notice = clientNotice({
    timeChanged: !move.keepsTime,
    client: job.person_id === null ? null : { agreedToWhatsApp: await agreedToVisitMessages(db, job.id) },
  });
  if (notice !== "messaged" || job.person_id === null) return { notice, message: null };
  return {
    notice,
    message: visitMessage(db, { personId: job.person_id, appointmentId: job.id, kind: "visit_moved", now }),
  };
}

/**
 * The time the client's notice counts from once this move changes the job's time: the time they last chose, which
 * a move ops make keeps, and none once the client asked for this one (src/policy/dispatch.ts).
 */
function startBeforeMoving(job: LiveJob, reason: MoveReason): string | null {
  if (!keepsTheClientsNotice(reason)) return null;
  return job.start_before_move ?? job.window_start;
}

/** What differs between the job now and the board the move was made from. */
function changedSince(job: LiveJob, expected: MoveInput["expected"]): Change[] {
  const changed: Change[] = [];
  if (job.technician_id !== expected.technicianId) changed.push("technician");
  if (new Date(job.window_start).getTime() !== new Date(expected.startsAt).getTime()) changed.push("time");
  return changed;
}

/** Whether the latest word on WhatsApp about their visits from the client of this job is yes. */
async function agreedToVisitMessages(db: D1Database, appointmentId: string): Promise<boolean> {
  const latest = await db
    .prepare(`SELECT ${LATEST_VISITS_CONSENT} AS granted FROM appointments a WHERE a.id = ?1`)
    .bind(appointmentId)
    .first<{ granted: number | null }>();
  return latest?.granted === 1;
}

/** One half-slot of the technician's day, claimed for the move under the key holds use. */
const claimOf = (db: D1Database, move: PlannedMove, claim: string): D1PreparedStatement =>
  db
    .prepare("INSERT INTO slot_claims (technician_id, date, claim, move_id) VALUES (?1, ?2, ?3, ?4)")
    .bind(move.technicianId, move.date, claim, move.id);

const releasingClaims = (db: D1Database, moveId: string): D1PreparedStatement =>
  db.prepare("DELETE FROM slot_claims WHERE move_id = ?1").bind(moveId);

/** A window the job would land in, and when it would start there. */
interface RoomStart {
  readonly window: BookingWindow;
  readonly starts_at: string;
}

interface Room {
  readonly technician_id: string;
  readonly date: string;
  /** The windows the job would land in, by the check a move runs. */
  readonly windows: BookingWindow[];
  readonly starts: RoomStart[];
}

interface Rooms {
  readonly rooms: Room[];
  /** The days of the week ops blacked out, other than the job's own: a move onto one needs a reason. */
  readonly blackouts: string[];
}

/**
 * Where a job in hand can go in the week from `from`: each technician's day
 * with a window the job would land in, by the same check a move runs, so the
 * board offers no window the move would be refused. Not where it already is.
 * Null for a job no longer live, or one the technician has begun by more than
 * their check-in, which no move takes.
 */
export async function dispatchRoomFor(
  db: D1Database,
  input: { readonly appointmentId: string; readonly from: string },
  now: Date,
): Promise<Rooms | null> {
  const job = await liveJob(db, input.appointmentId);
  if (job === null || !mayMove({ job, clearingCheckIn: true })) return null;
  const dates = weekFrom(input.from);
  const to = dates[dates.length - 1] ?? input.from;
  const [technicians, held, schedule, blackouts, clientVisits] = await Promise.all([
    activeTechnicians(db),
    occupancy({ db, from: input.from, to, now, exceptVisitId: job.id }),
    loadSlotSchedule(db),
    loadBlackouts(db, input.from, to),
    visitsOfClient(db, job.person_id, job.id),
  ]);
  const visit = { minutes: bookedMinutes(job), start: new Date(job.window_start) };
  const from = { technicianId: job.technician_id, date: indiaDate(visit.start) };
  const startsFor = (technicianId: string, date: string): RoomStart[] =>
    BOOKING_WINDOWS.flatMap((window) => {
      const target = targetOf({ job, technicianId, place: { date, window }, schedule, now });
      if (isWhereItIs(job, target)) return [];
      const beside = breaksRotation(clientVisits, from, target);
      const landing = landingOf({
        day: held(technicianId, date),
        job: visit,
        target,
        blackoutWithoutReason: false,
        beside,
      });
      if (landing.kind === "refused") return [];
      return [{ window, starts_at: timesAt(target, landing.start, visit, schedule).start.toISOString() }];
    });
  const roomOn = (technicianId: string, date: string): Room => {
    const starts = startsFor(technicianId, date);
    return { technician_id: technicianId, date, windows: starts.map((each) => each.window), starts };
  };
  const ownDate = indiaDate(visit.start);
  return {
    rooms: technicians
      .flatMap((technician) => dates.map((date) => roomOn(technician.id, date)))
      .filter((room) => room.starts.length > 0),
    blackouts: dates.filter((date) => blackouts.has(date) && date !== ownDate),
  };
}

/**
 * Ops called the client about a move they had not heard of, which closes its
 * task. Recorded once, and only for a move still untold: false for any other.
 * The audit entry goes in the same batch (src/domain/ops/audit.ts).
 */
export async function recordToldByPhone(
  db: D1Database,
  input: { readonly moveId: string; readonly actor: string; readonly audit: AuditEntry; readonly now: Date },
): Promise<boolean> {
  const untold = await db
    .prepare(
      `SELECT 1 FROM dispatch_moves m JOIN appointments a ON a.id = m.appointment_id WHERE m.id = ?1 AND ${UNTOLD_MOVE}`,
    )
    .bind(input.moveId)
    .first();
  if (untold === null) return false;
  const at = input.now.toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE dispatch_moves SET told_at = ?2, told_by = ?3, updated_at = ?2 WHERE id = ?1 AND told_at IS NULL",
      )
      .bind(input.moveId, at, input.actor),
    auditStatement(db, input.audit, input.now),
  ]);
  return true;
}
