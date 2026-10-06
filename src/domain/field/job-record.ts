// What a technician's step writes to our own record of field work, in the same batch as the step itself: the visit's
// status as they arrive, starts and closes it, its visits row at the close, and the pieces. Each write is safe to run again, since a phone replays its outbox.

import { cycleDaysFor, type Cycles } from "../../config/pieces.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import type { JobEventKind } from "../../policy/in-job-steps.ts";
import { storedOutcomeOf } from "./job-event-bodies.ts";
import { failedPieceStatement, fittedPieceStatement, pieceStepOf } from "./pieces.ts";
import { closeVisit, moveVisit } from "../visits/visit-status.ts";

export interface LandingStep {
  readonly visit: { readonly id: string; readonly personId: string | null };
  readonly kind: JobEventKind;
  readonly body: Record<string, unknown>;
  /** The phone's time for the step, within bounds. */
  readonly occurredAt: Date;
  /** The replacement cycles in force, which a piece's due date is counted by. */
  readonly cycles: Cycles;
  readonly now: Date;
}

/** The statements that record the step in our own database; none for a step that changes nothing but its event. */
export async function jobRecordOf(db: D1Database, step: LandingStep): Promise<D1PreparedStatement[]> {
  const at = step.now.toISOString();
  switch (step.kind) {
    case "check_in":
      return [moveVisit(db, step.visit.id, "check_in", at)];
    case "start":
      return [moveVisit(db, step.visit.id, "start", at)];
    case "outcome":
      return closingStatements(db, step);
    case "piece":
      return pieceStatements(db, step);
    // The photographs are in R2 already, and the checklist and what was used are read from the event itself.
    case "before_photos":
    case "checklist":
    case "consumables":
    case "after_photos":
      return [];
  }
}

/** The close: the visit moved to its outcome's status, and its visits row from the job's own times. */
async function closingStatements(db: D1Database, step: LandingStep): Promise<D1PreparedStatement[]> {
  const stored = storedOutcomeOf(step.body);
  // Anything but a done or a no-show closes the job as partial.
  const outcome = stored?.outcome ?? "partial";
  const at = step.now.toISOString();
  const startedAt = outcome === "no_show" ? null : await startedAtOf(db, step.visit.id);
  const reason = stored?.outcome === "partial" ? stored.reason : null;
  const times = { startedAt, endedAt: step.occurredAt.toISOString() };
  return [
    moveVisit(db, step.visit.id, outcome, at),
    closeVisit({ db, appointmentId: step.visit.id, outcome, times, partialReason: reason, at }),
  ];
}

/** When the phone said the job started; null for one that never did. */
async function startedAtOf(db: D1Database, appointmentId: string): Promise<string | null> {
  const start = await db
    .prepare(
      `SELECT occurred_at FROM job_events WHERE appointment_id = ?1 AND kind = 'start' AND superseded = 0
       ORDER BY received_at, rowid LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ occurred_at: string }>();
  return start?.occurred_at ?? null;
}

/**
 * The piece fitted, due a cycle of its base from the day in India the phone fitted it, and each that failed. A visit
 * with no client of ours has nobody to record a piece for.
 */
function pieceStatements(db: D1Database, step: LandingStep): D1PreparedStatement[] {
  const personId = step.visit.personId;
  if (personId === null) return [];
  const pieces = pieceStepOf(step.body);
  const failed = pieces.failed.map((failure) =>
    failedPieceStatement(db, { personId, pieceCode: failure.code, reason: failure.reason, now: step.now }),
  );
  if (pieces.fitted === null) return failed;

  const fittedOn = indiaDate(step.occurredAt);
  const fitted = fittedPieceStatement(db, {
    personId,
    appointmentId: step.visit.id,
    pieceCode: pieces.fitted.code,
    base: pieces.fitted.base,
    supplierLot: pieces.fitted.supplierLot,
    fittedOn,
    replacementDue: addDays(fittedOn, cycleDaysFor(pieces.fitted.base, step.cycles)),
    now: step.now,
  });
  return [...failed, fitted];
}
