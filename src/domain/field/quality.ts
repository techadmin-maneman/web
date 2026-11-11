// A technician's quality over the last 30 days, on their Me screen (docs/technician-redesign/PLAN.md, gap 11; owner,
// 10 November 2026): on time, their visits checked in by the booked start; and the hairline redo rate, their first fits
// followed by another first fit for the same client within 30 days. The client rating follows once ratings exist.

import { DAY_MS } from "../../lib/durations.ts";

/** The days each count looks back over. */
export const QUALITY_DAYS = 30;

/** The days after a first fit within which another for the same client counts it redone. */
export const REDO_DAYS = 30;

export interface Quality {
  /** Visits checked in, and how many of them by the booked start. */
  readonly visits: number;
  readonly on_time: number;
  /** First fits done, and how many were fitted again within 30 days. */
  readonly fits: number;
  readonly redone: number;
}

export async function qualityOf(db: D1Database, technicianId: string, now: Date): Promise<Quality> {
  const since = new Date(now.getTime() - QUALITY_DAYS * DAY_MS).toISOString();
  const until = now.toISOString();
  const [checkIns, fits] = await db.batch<{ total: number; counted: number }>([
    db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(e.occurred_at <= a.window_start), 0) AS counted
           FROM appointments a INDEXED BY appointments_by_technician
           JOIN job_events e ON e.appointment_id = a.id AND e.kind = 'check_in' AND e.superseded = 0
          WHERE a.technician_id = ?1 AND a.window_start >= ?2 AND a.window_start < ?3 AND a.deleted_at IS NULL`,
      )
      .bind(technicianId, since, until),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(EXISTS (
                  SELECT 1 FROM appointments later INDEXED BY appointments_by_person
                   WHERE later.person_id = a.person_id AND later.type = 'first_fit' AND later.deleted_at IS NULL
                     AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start
                     AND later.window_start <= strftime('%Y-%m-%dT%H:%M:%fZ', a.window_start, ?4))), 0) AS counted
           FROM appointments a INDEXED BY appointments_by_technician
          WHERE a.technician_id = ?1 AND a.window_start >= ?2 AND a.window_start < ?3 AND a.type = 'first_fit'
            AND a.status = 'completed' AND a.deleted_at IS NULL`,
      )
      .bind(technicianId, since, until, `+${String(REDO_DAYS)} days`),
  ]);
  const visits = checkIns?.results[0];
  const fitted = fits?.results[0];
  return {
    visits: visits?.total ?? 0,
    on_time: visits?.counted ?? 0,
    fits: fitted?.total ?? 0,
    redone: fitted?.counted ?? 0,
  };
}
