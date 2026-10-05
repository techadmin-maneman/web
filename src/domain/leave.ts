// A technician's leave, recorded by ops in the console (ADR 0062).
//
// Leave is read by the same clash check that reads slot_claims
// (docs/decisions/0034-clash-check.md), which is what makes a job on a day off
// refused rather than merely discouraged: booking never offers the day, and
// dispatch answers "on_leave" before anything is written.
//
// Leave recorded over jobs already booked moves none of them: ops are told
// which, the board marks them, and each waits on the Tasks board until it is
// moved (docs/decisions/0074-hand-offs-and-messages.md).

import type { VisitType } from "../config/visit-types.ts";
import { addDays } from "../lib/india-time.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";

/** One period, both ends inclusive, as ops recorded it. */
interface LeavePeriod {
  readonly id: string;
  readonly technician_id: string;
  readonly from: string;
  readonly to: string;
  readonly note: string | null;
}

/** How far ahead leave may be recorded, so a typed year cannot empty the board. */
export const LEAVE_MAX_DAYS = 365;

interface NewLeave {
  readonly technicianId: string;
  readonly from: string;
  readonly to: string;
  readonly note: string | null;
  /** The Access identity that recorded it (ADR 0031). */
  readonly actor: string;
}

/** A job still booked for a technician on a day he is now away: ops move it (OPS-07). */
interface JobOnLeave {
  readonly appointment_id: string;
  readonly starts_at: string;
  readonly type: VisitType | null;
  /** The client's name; null for a visit with no client on our records. */
  readonly client: string | null;
}

/**
 * Whether technician leave `l` covers the India day of appointment `a`: the leave the board draws and the Tasks
 * board reads, as the clash check reads it (ADR 0062).
 */
export const LEAVE_ON_THE_DAY = `l.technician_id = a.technician_id AND l.cancelled_at IS NULL
  AND l.from_date <= date(a.window_start, '+330 minutes') AND l.to_date >= date(a.window_start, '+330 minutes')`;

/** The technician's jobs still booked on the days from `from` to `to`, soonest first. */
async function jobsOnLeave(
  db: D1Database,
  input: { technicianId: string; from: string; to: string },
): Promise<JobOnLeave[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id AS appointment_id, a.window_start AS starts_at, a.type, p.name AS client
       FROM appointments a LEFT JOIN people p ON p.id = a.person_id AND p.erased_at IS NULL
       WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched')
         AND date(a.window_start, '+330 minutes') BETWEEN ?2 AND ?3
       ORDER BY a.window_start`,
    )
    .bind(input.technicianId, input.from, input.to)
    .all<JobOnLeave>();
  return results;
}

type LeaveOutcome =
  | {
      readonly kind: "recorded";
      readonly id: string;
      /** The jobs already booked on those days, which the leave does not move: ops do (OPS-07). */
      readonly jobs: JobOnLeave[];
    }
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

/** A period that has not ended, with the jobs still booked on its days. */
interface StandingLeave extends LeavePeriod {
  readonly jobs: JobOnLeave[];
}

/**
 * One technician's leave that has not ended before `today`, soonest first, each with the jobs still booked on its
 * days from today on: what the technician's page lists, however long after the leave was recorded.
 */
export async function standingLeave(db: D1Database, technicianId: string, today: string): Promise<StandingLeave[]> {
  const { results } = await db
    .prepare(
      `SELECT id, technician_id, from_date AS "from", to_date AS "to", note FROM technician_leave
       WHERE technician_id = ?1 AND cancelled_at IS NULL AND to_date >= ?2
       ORDER BY from_date, created_at`,
    )
    .bind(technicianId, today)
    .all<LeavePeriod>();
  return Promise.all(
    results.map(async (period) => {
      const from = period.from < today ? today : period.from;
      const jobs = await jobsOnLeave(db, { technicianId, from, to: period.to });
      return { ...period, jobs };
    }),
  );
}

/**
 * Records leave, with its audit entry in the same batch (src/domain/audit.ts). Days already recorded are left as
 * they are rather than refused: two overlapping periods keep the technician away on the same days, and ops should not
 * have to unpick their own entries to add a day.
 */
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
  const jobs = await jobsOnLeave(db, { technicianId: leave.technicianId, from: leave.from, to: leave.to });
  return { kind: "recorded", id, jobs };
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
