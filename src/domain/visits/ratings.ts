// A client's rating of a visit done (docs/decisions/0260-ratings.md): one to five stars, once, on a visit of theirs that
// ended with something done, within the days ops set after it; kept with the technician who did it, and whether it was
// low under the setting then. A low one is a Care task on its own: the Tasks queue reads the low ratings no closure has
// settled (src/domain/ops/task-queues.ts).

import { DAY_MS } from "../../lib/durations.ts";
import { isLowRating, STARS_MAX, STARS_MIN, type Ratings } from "../../policy/ratings.ts";
import { VISIT_ENDED } from "../../config/statuses.ts";

export interface Rating {
  readonly stars: number;
  readonly at: string;
  /** Under the setting in force when given: Care call the client. */
  readonly low: boolean;
}

/** not_done: not ended, or ended with nothing done; closed: past the days to rate it; rated: it has its rating. */
export type RatingRefusal = "not_found" | "not_done" | "closed" | "rated";

export interface RateableVisit {
  readonly status: string;
  readonly outcome: string | null;
  /** When the visit was booked to start. */
  readonly startsAt: string;
}

/** Whether a visit can take a rating now: ended done or partly done, and still within the days to rate it. */
export function rateable(visit: RateableVisit, ratings: Ratings, now: Date): RatingRefusal | null {
  const ended = (VISIT_ENDED as readonly string[]).includes(visit.status);
  if (!ended || (visit.outcome !== "done" && visit.outcome !== "partial")) return "not_done";
  return now.getTime() - Date.parse(visit.startsAt) > ratings.rate_within_days * DAY_MS ? "closed" : null;
}

interface VisitRow {
  readonly status: string;
  readonly window_start: string;
  readonly technician_id: string | null;
  readonly outcome: string | null;
}

export async function rateVisit(
  db: D1Database,
  rating: {
    readonly personId: string;
    readonly visitId: string;
    readonly stars: number;
    readonly ratings: Ratings;
    readonly now: Date;
  },
): Promise<Rating | RatingRefusal> {
  if (!Number.isInteger(rating.stars) || rating.stars < STARS_MIN || rating.stars > STARS_MAX) return "not_done";
  const visit = await db
    .prepare(
      `SELECT a.status, a.window_start, a.technician_id, v.outcome FROM appointments a
         LEFT JOIN visit_outcomes v ON v.appointment_id = a.id
        WHERE a.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(rating.visitId, rating.personId)
    .first<VisitRow>();
  if (visit === null) return "not_found";
  const refused = rateable({ ...visit, startsAt: visit.window_start }, rating.ratings, rating.now);
  if (refused !== null) return refused;
  const at = rating.now.toISOString();
  const low = isLowRating(rating.stars, rating.ratings);
  const { results } = await db
    .prepare(
      `INSERT INTO visit_ratings (appointment_id, person_id, technician_id, stars, low, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (appointment_id) DO NOTHING RETURNING appointment_id`,
    )
    .bind(rating.visitId, rating.personId, visit.technician_id, rating.stars, low ? 1 : 0, at)
    .all();
  return results.length === 0 ? "rated" : { stars: rating.stars, at, low };
}

/** The visit's rating; null before the client gives one. */
export async function ratingOf(db: D1Database, visitId: string): Promise<Rating | null> {
  const row = await db
    .prepare("SELECT stars, created_at AS at, low FROM visit_ratings WHERE appointment_id = ?1")
    .bind(visitId)
    .first<{ stars: number; at: string; low: number }>();
  return row === null ? null : { stars: row.stars, at: row.at, low: row.low === 1 };
}
