// Why a client is not going ahead with a fit after their consultation, as ops see and change it on the client's page
// (docs/decisions/0149-lost-reasons.md). The technician picks it as the consultation closes; Care may set it later, as
// the client tells them, or clear it.

import { jobSheet, knownCodes } from "../field/job-sheet-settings.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

/** What the client said at each of these consultations: the reason kept with a no, and whether they said yes. */
export interface GoingAhead {
  readonly lost: ReadonlyMap<string, string>;
  /** The technician's answer, where they were asked: true for a yes. */
  readonly said: ReadonlyMap<string, boolean>;
}

/** The reason kept with each of these visits that has one, and the client's yes or no where the technician asked. */
export async function lostReasonsOf(db: D1Database, appointmentIds: readonly string[]): Promise<GoingAhead> {
  if (appointmentIds.length === 0) return { lost: new Map(), said: new Map() };
  const { results } = await db
    .prepare(
      `SELECT appointment_id, lost_reason, going_ahead FROM visit_outcomes
       WHERE (lost_reason IS NOT NULL OR going_ahead IS NOT NULL)
         AND appointment_id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(appointmentIds))
    .all<{ appointment_id: string; lost_reason: string | null; going_ahead: number | null }>();
  return {
    lost: new Map(results.flatMap((row) => (row.lost_reason === null ? [] : [[row.appointment_id, row.lost_reason]]))),
    said: new Map(
      results.flatMap((row) => (row.going_ahead === null ? [] : [[row.appointment_id, row.going_ahead === 1]])),
    ),
  };
}

/**
 * Sets a closed consultation's reason, or clears it with null. "not_found" for a visit that is no closed
 * consultation; "unknown_reason" for a code ops never listed.
 */
export async function setLostReason(
  db: D1Database,
  change: {
    readonly appointmentId: string;
    readonly reason: string | null;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<"set" | "not_found" | "unknown_reason"> {
  const consultation = await db
    .prepare(
      `SELECT 1 FROM visit_outcomes v JOIN appointments a ON a.id = v.appointment_id
       WHERE v.appointment_id = ?1 AND a.type = 'consultation' AND a.deleted_at IS NULL`,
    )
    .bind(change.appointmentId)
    .first();
  if (consultation === null) return "not_found";
  if (change.reason !== null && !knownCodes((await jobSheet(db)).lostReasons).has(change.reason)) {
    return "unknown_reason";
  }
  await db.batch([
    db
      .prepare("UPDATE visit_outcomes SET lost_reason = ?2, updated_at = ?3 WHERE appointment_id = ?1")
      .bind(change.appointmentId, change.reason, change.now.toISOString()),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "visit.lost_reason",
        subject: { kind: "visit", id: change.appointmentId },
        requestId: change.requestId,
        detail: { reason: change.reason },
      },
      change.now,
    ),
  ]);
  return "set";
}
