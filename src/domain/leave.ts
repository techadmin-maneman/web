// A technician's leave, recorded by ops in the console (ADR 0062).
//
// FSM cannot hold this for us: its availability calls answer free time, not why
// time is not free, and its Time_Off module takes a type whose list lives in
// FSM's Setup screens, which the API does not reach. So leave is ours, and it
// is read by the same clash check that reads slot_claims
// (docs/decisions/0034-clash-check.md), which is what makes a job on a day off
// refused rather than merely discouraged: booking never offers the day, and
// dispatch answers "on_leave" before anything is written to FSM.

import { addDays } from "../lib/india-time.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";

/** One period, both ends inclusive, as ops recorded it. */
export interface LeavePeriod {
  readonly id: string;
  readonly technician_id: string;
  readonly from: string;
  readonly to: string;
  readonly note: string | null;
}

/** How far ahead leave may be recorded, so a typed year cannot empty the board. */
export const LEAVE_MAX_DAYS = 365;

export interface NewLeave {
  readonly technicianId: string;
  readonly from: string;
  readonly to: string;
  readonly note: string | null;
  /** The Access identity that recorded it (ADR 0031). */
  readonly actor: string;
}

export type LeaveOutcome =
  | { readonly kind: "recorded"; readonly id: string }
  | { readonly kind: "no_such_technician" }
  /** The dates are the wrong way round, or reach further ahead than LEAVE_MAX_DAYS. */
  | { readonly kind: "bad_dates" };

/** Leave overlapping the days from `from` to `to`, clipped to nothing: the board clips it itself. */
export async function leaveBetween(db: D1Database, from: string, to: string): Promise<LeavePeriod[]> {
  const { results } = await db
    .prepare(
      `SELECT id, technician_id, from_date AS "from", to_date AS "to", note FROM technician_leave
       WHERE cancelled_at IS NULL AND from_date <= ?2 AND to_date >= ?1
       ORDER BY from_date, technician_id`,
    )
    .bind(from, to)
    .all<LeavePeriod>();
  return results;
}

/** Every technician's leave that has not ended before `from`, for the Technicians screen. */
export async function leaveFrom(db: D1Database, from: string): Promise<LeavePeriod[]> {
  const { results } = await db
    .prepare(
      `SELECT id, technician_id, from_date AS "from", to_date AS "to", note FROM technician_leave
       WHERE cancelled_at IS NULL AND to_date >= ?1
       ORDER BY from_date, technician_id`,
    )
    .bind(from)
    .all<LeavePeriod>();
  return results;
}

/**
 * Records leave. Days already recorded are left as they are rather than
 * refused: two overlapping periods keep the technician away on the same days,
 * and ops should not have to unpick their own entries to add a day.
 */
/** Records leave, with its audit entry in the same batch (src/domain/audit.ts). */
export async function recordLeave(
  db: D1Database,
  leave: NewLeave,
  today: string,
  now: Date,
  audit: AuditEntry,
): Promise<LeaveOutcome> {
  if (leave.to < leave.from || leave.to > addDays(today, LEAVE_MAX_DAYS)) return { kind: "bad_dates" };

  const technician = await db
    .prepare("SELECT id FROM technicians WHERE id = ?1 AND active = 1")
    .bind(leave.technicianId)
    .first<{ id: string }>();
  if (technician === null) return { kind: "no_such_technician" };

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO technician_leave (id, technician_id, from_date, to_date, note, actor, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(id, leave.technicianId, leave.from, leave.to, leave.note, leave.actor, now.toISOString()),
    auditStatement(db, audit, now),
  ]);
  return { kind: "recorded", id };
}

/**
 * Takes leave back, with its audit entry in the same batch. False when there is
 * no such uncancelled period of that technician's.
 */
export async function cancelLeave(
  db: D1Database,
  input: { technicianId: string; leaveId: string; actor: string; audit: AuditEntry },
  now: Date,
): Promise<boolean> {
  const standing = await db
    .prepare("SELECT 1 FROM technician_leave WHERE id = ?1 AND technician_id = ?2 AND cancelled_at IS NULL")
    .bind(input.leaveId, input.technicianId)
    .first();
  if (standing === null) return false;
  await db.batch([
    db
      .prepare(
        `UPDATE technician_leave SET cancelled_at = ?3, cancelled_by = ?4
         WHERE id = ?1 AND technician_id = ?2 AND cancelled_at IS NULL`,
      )
      .bind(input.leaveId, input.technicianId, now.toISOString(), input.actor),
    auditStatement(db, input.audit, now),
  ]);
  return true;
}
