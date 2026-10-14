// The client's visits the rotation rule reads (src/policy/technician-rotation.ts): who came, or comes, on which day.

import { indiaDate } from "../../lib/india-time.ts";
import type { ClientVisit } from "../../policy/technician-rotation.ts";
import { paidNotBooked } from "./hold-stages.ts";

/**
 * The client's visits that happened or will: every visit not cancelled, a no-show among them, since a technician went
 * to the door, and each booking paid for that is still to become one. `exceptVisitId` is the visit being moved or
 * replaced, whose own technician does not stand next to it. None for no client.
 */
export async function visitsOfClient(
  db: D1Database,
  personId: string | null,
  exceptVisitId: string | null = null,
): Promise<ClientVisit[]> {
  if (personId === null) return [];
  const [visits, holds] = await Promise.all([
    db
      .prepare(
        `SELECT window_start, technician_id FROM appointments
         WHERE person_id = ?1 AND deleted_at IS NULL AND status != 'cancelled' AND technician_id IS NOT NULL
           AND id IS NOT ?2`,
      )
      .bind(personId, exceptVisitId)
      .all<{ window_start: string; technician_id: string }>(),
    db
      .prepare(
        `SELECT date, technician_id FROM slot_holds
         WHERE person_id = ?1 AND ${paidNotBooked("slot_holds")} AND moves_appointment_id IS NOT ?2`,
      )
      .bind(personId, exceptVisitId)
      .all<{ date: string; technician_id: string }>(),
  ]);
  return [
    ...visits.results.map((row) => ({ date: indiaDate(new Date(row.window_start)), technicianId: row.technician_id })),
    ...holds.results.map((row) => ({ date: row.date, technicianId: row.technician_id })),
  ];
}
