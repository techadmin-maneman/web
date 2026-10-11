// Which technicians may take a job on the board: those in its city, and for a first fit those trained to fit
// (docs/decisions/0117-a-technician-takes-visits-in-their-own-city.md,
// docs/decisions/0119-blackouts-by-city-and-trained-fitters.md).

import { visitCity, type Technician } from "../booking/occupancy.ts";
import type { LiveJob } from "./dispatch-landing.ts";

/**
 * Why a technician may not take the visit; null where they may. Its own technician always may. Another must work in
 * the visit's city, where that is known (docs/decisions/0117-a-technician-takes-visits-in-their-own-city.md), and be
 * trained to fit for a first fit (docs/decisions/0119-blackouts-by-city-and-trained-fitters.md).
 */
export async function whyNotThem(
  db: D1Database,
  job: LiveJob,
  technicianId: string,
): Promise<"other_city" | "not_trained" | null> {
  if (technicianId === job.technician_id) return null;
  const row = await db
    .prepare(
      `SELECT ${visitCity("?2", "?3")} AS visit_city, t.city AS technician_city, t.fits_trained
       FROM technicians t WHERE t.id = ?1`,
    )
    .bind(technicianId, job.service_pincode, job.person_id)
    .first<{ visit_city: string | null; technician_city: string | null; fits_trained: number }>();
  const where = row?.visit_city ?? null;
  if (where !== null && row?.technician_city !== where) return "other_city";
  return job.type === "first_fit" && row?.fits_trained !== 1 ? "not_trained" : null;
}

/**
 * Who the board offers a job to: its own technician, and the others who work in its city, or all where it is unknown;
 * for a first fit, only those trained to fit.
 */
export function roomTechnicians(db: D1Database, job: LiveJob): Promise<Technician[]> {
  return db
    .prepare(
      `SELECT t.id, t.name, t.initials FROM technicians t
       WHERE t.active = 1 AND (t.id = ?1 OR ((${visitCity("?2", "?3")} IS NULL OR t.city = ${visitCity("?2", "?3")})
         AND (?4 = 0 OR t.fits_trained = 1)))
       ORDER BY t.name`,
    )
    .bind(job.technician_id, job.service_pincode, job.person_id, job.type === "first_fit" ? 1 : 0)
    .all<Technician>()
    .then((all) => all.results);
}
