// Ops closing a visit by hand, for work that only lived on a technician's phone that was lost before it sent anything.
// The visit moves to its outcome's status and its visits row is written in one batch with the audit entry, so a second
// close, or the phone's own close landing first, leaves the first standing. A one visit closed as done is then decided
// by the client's choice at its piece step, as the phone's own close decides it. A no-show stands on the technician's
// check-in, once its wait has run out, as the phone's own does, and opens the case ops rule on.

import { indiaDate } from "../../lib/india-time.ts";
import type { VisitType } from "../../config/visit-types.ts";
import type { Waits } from "../../policy/no-show.ts";
import { noShowReadiness, openNoShowCase } from "../no-shows/no-shows.ts";
import { latestArrival } from "./check-ins.ts";
import { auditStatementIfClosed, type AuditEntry } from "../platform/audit.ts";
import { closeOneVisit } from "./one-visit.ts";
import type { LinkDeps } from "../money/payment-links.ts";
import { landedOutcome } from "./visit-begun.ts";
import { closeVisit, durationOf, moveVisit, STEPS, type AppointmentStatus, type ClosedByHand } from "./visit-status.ts";
import { visitUpkeep } from "./visit-upkeep.ts";

type HandOutcome = "done" | "partial" | "no_show";

/** The status a visit closed by hand ends in, as its step moves it (STEPS). */
const CLOSES_AS = { done: "completed", partial: "terminated", no_show: "terminated" } as const satisfies Record<
  HandOutcome,
  AppointmentStatus
>;

interface HandClose {
  readonly appointmentId: string;
  readonly outcome: HandOutcome;
  /** When the work began and ended; a no-show gives none. */
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly byHand: ClosedByHand;
  readonly audit: AuditEntry;
  /** The no-show waits in force, which ops set. */
  readonly waits: Waits;
}

type HandClosed =
  | {
      readonly kind: "closed";
      readonly status: (typeof CLOSES_AS)[HandOutcome];
      readonly durationMinutes: number | null;
    }
  | {
      readonly kind: "refused";
      readonly code: "not_found" | "already_closed" | "too_early_to_close" | "bad_times" | "no_check_in";
    };

interface ClosingVisit {
  status: AppointmentStatus;
  person_id: string;
  technician_id: string | null;
  type: VisitType;
  window_start: string;
  one_visit: string | null;
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
export async function closeByHand(db: D1Database, deps: LinkDeps, close: HandClose, now: Date): Promise<HandClosed> {
  const visit = await db
    .prepare(
      `SELECT a.status, a.person_id, a.technician_id, a.type, a.window_start, a.one_visit, ${landedOutcome("a")} AS landed
       FROM appointments a
       WHERE a.id = ?1 AND a.deleted_at IS NULL`,
    )
    .bind(close.appointmentId)
    .first<ClosingVisit>();
  if (visit === null) return { kind: "refused", code: "not_found" };
  const windowStart = visit.window_start;
  const step = STEPS[close.outcome];
  if (!step.from.includes(visit.status) || visit.landed !== null) return { kind: "refused", code: "already_closed" };
  if (Date.parse(windowStart) > now.getTime()) return { kind: "refused", code: "too_early_to_close" };
  if (close.outcome === "no_show") return closeAsNoShow(db, close, visit, now);
  const { startedAt, endedAt } = close;
  if (startedAt === null || endedAt === null) return { kind: "refused", code: "bad_times" };
  const times = { startedAt, endedAt };
  if (!timesFit(times, windowStart, now)) return { kind: "refused", code: "bad_times" };

  const at = now.toISOString();
  const [moved] = await db.batch([
    moveVisit(db, close.appointmentId, close.outcome, at),
    closeVisit({
      db,
      appointmentId: close.appointmentId,
      outcome: close.outcome,
      times,
      partialReason: null,
      at,
      byHand: close.byHand,
    }),
    auditStatementIfClosed(db, close.audit, now, close.appointmentId),
    ...visitUpkeep(db, { visits: [close.appointmentId] }, at),
  ]);
  if (moved === undefined || moved.meta.changes === 0) return { kind: "refused", code: "already_closed" };
  if (close.outcome === "done" && visit.one_visit !== null) {
    const job = { id: close.appointmentId, personId: visit.person_id, windowStart: new Date(windowStart) };
    await closeOneVisit(db, deps, job, now);
  }
  return { kind: "closed", status: CLOSES_AS[close.outcome], durationMinutes: durationOf(times) };
}

/** A no-show closed by hand: the technician's check-in and its wait, as the phone's own close, and the case opened. */
async function closeAsNoShow(db: D1Database, close: HandClose, visit: ClosingVisit, now: Date): Promise<HandClosed> {
  const technicianId = visit.technician_id;
  const checkIn = technicianId === null ? null : await latestArrival(db, { id: close.appointmentId, technicianId });
  const job = { windowStart: new Date(visit.window_start), type: visit.type };
  const readiness = noShowReadiness(checkIn, job, now, close.waits);
  if (readiness.kind === "no_check_in") return { kind: "refused", code: "no_check_in" };
  if (readiness.kind === "too_early") return { kind: "refused", code: "too_early_to_close" };
  // As the phone's own no-show: never started, ended when it closed.
  const at = now.toISOString();
  const times = { startedAt: null, endedAt: at };
  const [moved] = await db.batch([
    moveVisit(db, close.appointmentId, "no_show", at),
    closeVisit({
      db,
      appointmentId: close.appointmentId,
      outcome: "no_show",
      times,
      partialReason: null,
      at,
      byHand: close.byHand,
    }),
    auditStatementIfClosed(db, close.audit, now, close.appointmentId),
    ...visitUpkeep(db, { visits: [close.appointmentId] }, at),
  ]);
  if (moved === undefined || moved.meta.changes === 0) return { kind: "refused", code: "already_closed" };
  await openNoShowCase(db, {
    appointmentId: close.appointmentId,
    checkIn: readiness.checkIn,
    waitStartsAt: readiness.waitStartsAt,
    waitEndsAt: readiness.waitEndsAt,
    now,
  });
  return { kind: "closed", status: CLOSES_AS.no_show, durationMinutes: null };
}
