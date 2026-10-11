// How far a job in hand is from each technician's other visits on a day, as the crow flies, so the move picker can
// list the nearest first (OPS-03). A straight line costs no call to Google and is close enough to rank by.

import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import type { Point } from "../../providers/routes/index.ts";
import { pinsOf } from "./day-route.ts";
import { LIVE } from "./dispatch-board.ts";

const EARTH_KM = 6371;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** The great-circle distance between two pins, in km. */
export function kmBetween(a: Point, b: Point): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

interface Day {
  readonly technician_id: string;
  readonly date: string;
}

/**
 * For each day asked about, the km from the job to the nearest of that technician's other visits that day, to one
 * decimal; null where the job has no pin, or none of their visits that day has one.
 */
export async function nearestKm(
  db: D1Database,
  appointmentId: string,
  days: readonly Day[],
): Promise<(number | null)[]> {
  const dates = [...new Set(days.map((day) => day.date))].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const job = (await pinsOf(db, [appointmentId])).get(appointmentId);
  if (job === undefined || first === undefined || last === undefined) return days.map(() => null);

  const { results } = await db
    .prepare(
      `SELECT a.id, a.technician_id, a.window_start FROM appointments a
       WHERE a.deleted_at IS NULL AND a.status IN ${LIVE} AND a.id <> ?1
         AND a.window_start >= ?2 AND a.window_start < ?3
         AND a.technician_id IN (SELECT value FROM json_each(?4))`,
    )
    .bind(
      appointmentId,
      indiaInstant(first, "00:00").toISOString(),
      indiaInstant(addDays(last, 1), "00:00").toISOString(),
      JSON.stringify([...new Set(days.map((day) => day.technician_id))]),
    )
    .all<{ id: string; technician_id: string; window_start: string }>();
  const pins = await pinsOf(
    db,
    results.map((visit) => visit.id),
  );

  return days.map((day) => {
    const distances = results
      .filter(
        (visit) => visit.technician_id === day.technician_id && indiaDate(new Date(visit.window_start)) === day.date,
      )
      .flatMap((visit) => {
        const pin = pins.get(visit.id);
        return pin === undefined ? [] : [kmBetween(job, pin)];
      });
    return distances.length === 0 ? null : Math.round(Math.min(...distances) * 10) / 10;
  });
}
