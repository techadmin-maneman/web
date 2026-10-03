// Ops closing a visit by hand, for work that only lived on a technician's phone that was lost before it sent anything.
// The visit moves to its outcome's status and its visits row is written in one batch with the audit entry, so a second
// close, or the phone's own close landing first, leaves the first standing.

import { indiaDate } from "../lib/india-time.ts";
import { auditStatementIfClosed, type AuditEntry } from "./audit.ts";
import { landedOutcome } from "./visit-begun.ts";
import { closeVisit, durationOf, moveVisit, STEPS, type AppointmentStatus, type ClosedByHand } from "./visit-status.ts";

export type HandOutcome = "done" | "partial";

/** The status a visit closed by hand ends in, as its step moves it (STEPS). */
const CLOSES_AS = { done: "completed", partial: "terminated" } as const satisfies Record<
  HandOutcome,
  AppointmentStatus
>;

export interface HandClose {
  readonly appointmentId: string;
  readonly outcome: HandOutcome;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly byHand: ClosedByHand;
  readonly audit: AuditEntry;
}

export type HandClosed =
  | {
      readonly kind: "closed";
      readonly status: (typeof CLOSES_AS)[HandOutcome];
      readonly durationMinutes: number | null;
    }
  | { readonly kind: "refused"; readonly code: "not_found" | "already_closed" | "too_early_to_close" | "bad_times" };

interface ClosingVisit {
  status: AppointmentStatus;
  window_start: string | null;
  landed: string | null;
}

/** Times a close can stand on: the work began before it ended, on the visit's own day in India, and has ended by now. */
function timesFit(times: { startedAt: string; endedAt: string }, visitStart: string, now: Date): boolean {
  const day = indiaDate(new Date(visitStart));
  if (indiaDate(new Date(times.startedAt)) !== day || indiaDate(new Date(times.endedAt)) !== day) return false;
  if (Date.parse(times.startedAt) >= Date.parse(times.endedAt)) return false;
  return Date.parse(times.endedAt) <= now.getTime();
}

/** Closes the visit as ops say it went, once: refused for a visit already closed, still to come, or not ours. */
export async function closeByHand(db: D1Database, close: HandClose, now: Date): Promise<HandClosed> {
  const visit = await db
    .prepare(
      `SELECT a.status, a.window_start, ${landedOutcome("a")} AS landed FROM appointments a
       WHERE a.id = ?1 AND a.deleted_at IS NULL`,
    )
    .bind(close.appointmentId)
    .first<ClosingVisit>();
  const windowStart = visit?.window_start ?? null;
  if (visit === null || windowStart === null) return { kind: "refused", code: "not_found" };
  const step = STEPS[close.outcome];
  if (!step.from.includes(visit.status) || visit.landed !== null) return { kind: "refused", code: "already_closed" };
  if (Date.parse(windowStart) > now.getTime()) return { kind: "refused", code: "too_early_to_close" };
  const times = { startedAt: close.startedAt, endedAt: close.endedAt };
  if (!timesFit(times, windowStart, now)) return { kind: "refused", code: "bad_times" };

  const at = now.toISOString();
  const [moved] = await db.batch([
    moveVisit(db, close.appointmentId, close.outcome, at),
    closeVisit(db, close.appointmentId, close.outcome, times, null, at, close.byHand),
    auditStatementIfClosed(db, close.audit, now, close.appointmentId),
  ]);
  // The count takes in what the appointments' triggers write as well, so any change at all means the visit moved.
  if (moved === undefined || moved.meta.changes === 0) return { kind: "refused", code: "already_closed" };
  return { kind: "closed", status: CLOSES_AS[close.outcome], durationMinutes: durationOf(times) };
}
