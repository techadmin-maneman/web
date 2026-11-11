// A technician's ask that ops move a visit, with why (docs/decisions/0249-schedule-kit-and-me.md): a task on the board
// until ops close it. A visit moved, given to another technician, closed or called off settles its own ask (migration
// 0208's trigger). One open a visit at a time; a second tap while it is open is the same ask.

import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";

export const RESCHEDULE_REASONS = ["client_asked", "running_late", "kit_problem"] as const;
export type RescheduleReason = (typeof RESCHEDULE_REASONS)[number];

/** An open ask, as the visit's card shows it. */
export interface RescheduleAsked {
  readonly asked_at: string;
  readonly reason: RescheduleReason;
}

/** The visit's open ask; null for none. */
export async function rescheduleAskedOf(db: D1Database, appointmentId: string): Promise<RescheduleAsked | null> {
  const row = await db
    .prepare(
      `SELECT requested_at, reason FROM reschedule_requests INDEXED BY reschedule_requests_open
        WHERE appointment_id = ?1 AND settled_at IS NULL`,
    )
    .bind(appointmentId)
    .first<{ requested_at: string; reason: RescheduleReason }>();
  return row === null ? null : { asked_at: row.requested_at, reason: row.reason };
}

/**
 * Asks ops to move the technician's own visit while it is still to happen or under way; "not_found" for a visit not
 * theirs, "not_changeable" for one closed or called off. The answer is the ask that stands, new or open already.
 */
export async function askToReschedule(
  db: D1Database,
  input: { appointmentId: string; technicianId: string; reason: RescheduleReason; now: Date },
): Promise<RescheduleAsked | "not_found" | "not_changeable"> {
  const visit = await db
    .prepare(
      `SELECT technician_id, ${statusIn("status", VISIT_LIVE)} AS live FROM appointments
        WHERE id = ?1 AND deleted_at IS NULL`,
    )
    .bind(input.appointmentId)
    .first<{ technician_id: string | null; live: number }>();
  if (visit?.technician_id !== input.technicianId) return "not_found";
  if (visit.live !== 1) return "not_changeable";
  await db
    .prepare(
      `INSERT OR IGNORE INTO reschedule_requests (id, appointment_id, technician_id, reason, requested_at)
       SELECT ?1, a.id, ?3, ?4, ?5 FROM appointments a
        WHERE a.id = ?2 AND a.technician_id = ?3 AND a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_LIVE)}`,
    )
    .bind(crypto.randomUUID(), input.appointmentId, input.technicianId, input.reason, input.now.toISOString())
    .run();
  return (await rescheduleAskedOf(db, input.appointmentId)) ?? "not_changeable";
}
