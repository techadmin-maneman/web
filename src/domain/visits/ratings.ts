// A client's rating of a visit done (docs/decisions/0260-ratings.md): one to five stars, once, on a visit of theirs that
// closed with something done; kept with the technician who did it. Under four, it opens a Care task on its own: the
// Tasks queue reads the low ratings no closure has settled (src/domain/ops/task-queues.ts).

import { STARS_MAX, STARS_MIN } from "../../policy/ratings.ts";

export interface Rating {
  readonly stars: number;
  readonly at: string;
}

/** not_done: not closed, or closed with nothing done; rated: it has its rating already. */
export type RatingRefusal = "not_found" | "not_done" | "rated";

interface VisitRow {
  readonly status: string;
  readonly technician_id: string | null;
  readonly outcome: string | null;
}

export async function rateVisit(
  db: D1Database,
  rating: { readonly personId: string; readonly visitId: string; readonly stars: number; readonly now: Date },
): Promise<Rating | RatingRefusal> {
  if (!Number.isInteger(rating.stars) || rating.stars < STARS_MIN || rating.stars > STARS_MAX) return "not_done";
  const visit = await db
    .prepare(
      `SELECT a.status, a.technician_id, v.outcome FROM appointments a
         LEFT JOIN visit_outcomes v ON v.appointment_id = a.id
        WHERE a.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(rating.visitId, rating.personId)
    .first<VisitRow>();
  if (visit === null) return "not_found";
  if (visit.status !== "completed" || (visit.outcome !== "done" && visit.outcome !== "partial")) return "not_done";
  const at = rating.now.toISOString();
  const { results } = await db
    .prepare(
      `INSERT INTO visit_ratings (appointment_id, person_id, technician_id, stars, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (appointment_id) DO NOTHING RETURNING appointment_id`,
    )
    .bind(rating.visitId, rating.personId, visit.technician_id, rating.stars, at)
    .all();
  return results.length === 0 ? "rated" : { stars: rating.stars, at };
}

/** The visit's rating; null before the client gives one. */
export async function ratingOf(db: D1Database, visitId: string): Promise<Rating | null> {
  const row = await db
    .prepare("SELECT stars, created_at AS at FROM visit_ratings WHERE appointment_id = ?1")
    .bind(visitId)
    .first<Rating>();
  return row;
}
