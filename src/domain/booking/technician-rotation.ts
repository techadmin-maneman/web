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
  return (await visitsOfClients(db, [personId]))(personId, exceptVisitId);
}

/**
 * visitsOfClient for many clients in two reads, as a re-plan of a day's drafts needs them: each client's visits, but
 * for the one being moved or replaced.
 */
export async function visitsOfClients(
  db: D1Database,
  personIds: readonly string[],
): Promise<(personId: string | null, exceptVisitId: string | null) => ClientVisit[]> {
  const whose = JSON.stringify([...new Set(personIds)]);
  const [visits, holds] = await Promise.all([
    db
      .prepare(
        `SELECT person_id, id, window_start, technician_id FROM appointments
         WHERE person_id IN (SELECT value FROM json_each(?1)) AND deleted_at IS NULL AND status != 'cancelled'
           AND technician_id IS NOT NULL`,
      )
      .bind(whose)
      .all<{ person_id: string; id: string; window_start: string; technician_id: string }>(),
    db
      .prepare(
        `SELECT person_id, moves_appointment_id, date, technician_id FROM slot_holds
         WHERE person_id IN (SELECT value FROM json_each(?1)) AND ${paidNotBooked("slot_holds")}`,
      )
      .bind(whose)
      .all<{ person_id: string; moves_appointment_id: string | null; date: string; technician_id: string }>(),
  ]);
  return (personId, exceptVisitId) => [
    ...visits.results
      .filter((row) => row.person_id === personId && row.id !== exceptVisitId)
      .map((row) => ({ date: indiaDate(new Date(row.window_start)), technicianId: row.technician_id })),
    ...holds.results
      .filter((row) => row.person_id === personId && row.moves_appointment_id !== exceptVisitId)
      .map((row) => ({ date: row.date, technicianId: row.technician_id })),
  ];
}
