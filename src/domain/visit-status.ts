// A visit's status, and the steps that move it on. A step only moves a visit forward, never back and never out of a
// closed status, and each move is one guarded UPDATE that callers put in the same batch as the fact that caused it.

import { minutesBetween } from "../lib/durations.ts";

/** The seven statuses the schema allows. Our own steps never write "other". */
export const APPOINTMENT_STATUSES = [
  "scheduled",
  "dispatched",
  "in_progress",
  "completed",
  "cancelled",
  "terminated",
  "other",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** How a closed visit ended: done, partly done with the technician's reason, or not at all, the client not home. */
export const VISIT_OUTCOMES = ["done", "partial", "no_show"] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

export type Step = "check_in" | "start" | "done" | "partial" | "no_show" | "cancel";

const NOT_STARTED: readonly AppointmentStatus[] = ["scheduled", "dispatched"];
const OPEN: readonly AppointmentStatus[] = ["scheduled", "dispatched", "in_progress"];

/**
 * The statuses a visit may be in for this step to apply, and where it goes. A visit can be closed from any open status,
 * since ops close by hand a job whose phone was lost before it sent anything. A visit already started can only be
 * closed as done or partial: a no-show or a cancel would say the work never happened.
 */
export const STEPS: Readonly<Record<Step, { from: readonly AppointmentStatus[]; to: AppointmentStatus }>> = {
  check_in: { from: ["scheduled"], to: "dispatched" },
  start: { from: NOT_STARTED, to: "in_progress" },
  done: { from: OPEN, to: "completed" },
  partial: { from: OPEN, to: "terminated" },
  no_show: { from: NOT_STARTED, to: "terminated" },
  cancel: { from: NOT_STARTED, to: "cancelled" },
};

/** One guarded UPDATE: changes nothing unless the visit is in an allowed status. Its `meta.changes` says which. */
export function moveVisit(db: D1Database, appointmentId: string, step: Step, at: string): D1PreparedStatement {
  const { from, to } = STEPS[step];
  return db
    .prepare(
      `UPDATE appointments SET status = ?2, synced_at = ?3
       WHERE id = ?1 AND deleted_at IS NULL AND status IN (SELECT value FROM json_each(?4))`,
    )
    .bind(appointmentId, to, at, JSON.stringify(from));
}

/** When the job started and ended. A no-show was never started. */
interface VisitTimes {
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

const CLOSED_AS: Readonly<Record<VisitOutcome, AppointmentStatus>> = {
  done: "completed",
  partial: "terminated",
  no_show: "terminated",
};

/** Ops closing a visit by hand, for work whose phone was lost before it sent anything: who, and why, as they typed it. */
export interface ClosedByHand {
  readonly by: string;
  readonly reason: string;
}

/**
 * The visits row a closed job becomes, from the job's own event times, or the times ops give when they close it by
 * hand. It is written only once the visit has been moved to its outcome's status, so in a batch after a refused move it
 * writes nothing, and a second close keeps the first.
 */
export function closeVisit(
  db: D1Database,
  appointmentId: string,
  outcome: VisitOutcome,
  times: VisitTimes,
  partialReason: string | null,
  at: string,
  byHand: ClosedByHand | null = null,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO visits (id, appointment_id, started_at, ended_at, duration_minutes, outcome, partial_reason,
         updated_at, closed_by, close_reason)
       SELECT ?1, id, ?3, ?4, ?5, ?6, ?7, ?8, ?10, ?11 FROM appointments
       WHERE id = ?2 AND deleted_at IS NULL AND status = ?9
       ON CONFLICT (appointment_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      appointmentId,
      times.startedAt,
      times.endedAt,
      durationOf(times),
      outcome,
      partialReason,
      at,
      CLOSED_AS[outcome],
      byHand?.by ?? null,
      byHand?.reason ?? null,
    );
}

export function durationOf(times: VisitTimes): number | null {
  if (times.startedAt === null || times.endedAt === null) return null;
  return minutesBetween(times.startedAt, times.endedAt);
}
