// A technician never takes two of a client's visits in a row
// (docs/decisions/0111-a-technician-never-takes-two-visits-in-a-row.md): whoever comes to a visit is not whoever comes to
// the client's visit just before it or just after it. Every place a technician is put on a visit leaves those out: the
// windows a client is offered, the hold that books one, ops' own booking, and the dispatch board's moves.

import { indiaDate } from "../lib/india-time.ts";
import { paidNotBooked } from "./hold-stages.ts";

/** One of a client's visits, done or still to come, or a booking paid for and not yet a visit: its day and who. */
interface ClientVisit {
  readonly date: string;
  readonly technicianId: string;
}

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

/** Places a visit is put: a technician on a day. */
interface Place {
  readonly technicianId: string | null;
  readonly date: string;
}

/**
 * Whether moving a visit from where it is to `to` puts its technician beside another of the client's visits. A move that
 * keeps its technician and day puts nobody there anew.
 */
export function movesBeside(visits: readonly ClientVisit[], from: Place, to: Place): boolean {
  if (to.technicianId === null || (to.technicianId === from.technicianId && to.date === from.date)) return false;
  return besideIt(visits, to.date).has(to.technicianId);
}

/**
 * The technicians who may not take a visit of the client's on `date`: whoever has their latest visit before that day,
 * their first after it, and any on the day itself.
 */
export function besideIt(visits: readonly ClientVisit[], date: string): ReadonlySet<string> {
  const days = visits.map((visit) => visit.date).sort();
  const before = days.filter((day) => day < date).at(-1);
  const after = days.find((day) => day > date);
  const beside = visits.filter((visit) => visit.date === date || visit.date === before || visit.date === after);
  return new Set(beside.map((visit) => visit.technicianId));
}
