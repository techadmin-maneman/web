// A technician's quality over the last 30 days, on their Me screen (src/policy/quality.ts): on time, their visits
// checked in by the booked start; and the hairline redo rate, their first fits done or left partly done, and of them
// those whose free refit was booked within 30 days (docs/decisions/0192-free-remakes.md), the partly done visit's Tasks
// row closed as it was. A no-show is no fit, nor is one closed "Can't fit today", which fitted no hairline; payroll
// counts that one a consultation too. And the average of the clients' ratings of their visits over the days ops set,
// once enough have rated them, and never how many did: a count beside it would tell one new rating from the change
// (docs/decisions/0260-ratings.md).

import { statusIn, VISIT_ENDED } from "../../config/statuses.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { QUALITY_DAYS, REDO_DAYS } from "../../policy/quality.ts";
import type { Ratings } from "../../policy/ratings.ts";
import { REMAKE_BOOKED } from "../booking/remakes.ts";

export interface Quality {
  /** Visits checked in, and how many of them by the booked start. */
  readonly visits: number;
  readonly on_time: number;
  /** First fits done or left partly done, and how many had their free refit booked within 30 days. */
  readonly fits: number;
  readonly redone: number;
  /** The average of clients' ratings over the days ops set, to one place; null with fewer than ops' fewest. */
  readonly rating: number | null;
  /** The days it covers. */
  readonly rating_days: number;
}

/** The average of `count` ratings adding up to `stars`, to one place; null with none. */
export const averageOf = (stars: number, count: number): number | null =>
  count === 0 ? null : Math.round((stars / count) * 10) / 10;

export async function qualityOf(db: D1Database, technicianId: string, now: Date, ratings: Ratings): Promise<Quality> {
  const since = new Date(now.getTime() - QUALITY_DAYS * DAY_MS).toISOString();
  const ratedSince = new Date(now.getTime() - ratings.average_days * DAY_MS).toISOString();
  const until = now.toISOString();
  const [checkIns, fits, rated] = await db.batch<{ total: number; counted: number }>([
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
                  SELECT 1 FROM task_closures c
                   WHERE c.task_group = 'partial_visit' AND c.subject_id = a.id AND c.reason = ?5
                     AND c.closed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', a.window_start, ?4))), 0) AS counted
           FROM appointments a INDEXED BY appointments_by_technician
          WHERE a.technician_id = ?1 AND a.window_start >= ?2 AND a.window_start < ?3 AND a.type = 'first_fit'
            AND ${statusIn("a.status", VISIT_ENDED)} AND a.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM visit_outcomes v
                             WHERE v.appointment_id = a.id
                               AND (v.outcome = 'no_show' OR COALESCE(v.partial_reason, '') = 'no_piece'))`,
      )
      .bind(technicianId, since, until, `+${String(REDO_DAYS)} days`, REMAKE_BOOKED),
    db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(stars), 0) AS counted
           FROM visit_ratings INDEXED BY visit_ratings_by_technician
          WHERE technician_id = ?1 AND created_at >= ?2 AND created_at <= ?3`,
      )
      .bind(technicianId, ratedSince, until),
  ]);
  const visits = checkIns?.results[0];
  const fitted = fits?.results[0];
  const given = rated?.results[0];
  const count = given?.total ?? 0;
  return {
    visits: visits?.total ?? 0,
    on_time: visits?.counted ?? 0,
    fits: fitted?.total ?? 0,
    redone: fitted?.counted ?? 0,
    rating: count < ratings.shown_from ? null : averageOf(given?.counted ?? 0, count),
    rating_days: ratings.average_days,
  };
}
