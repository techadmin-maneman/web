// A visit today with no technician: the Tasks board raised it the day before; on its day ops are told, once, until
// someone is sent or the visit is moved or called off. And each technician's visits to come, which switching them off
// would leave with nobody.

import { indiaDate, indiaInstant, addDays } from "../../lib/india-time.ts";
import { statusIn, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import type { AlertOnce, ResolveAlert } from "../ops/alerts.ts";

const KEY = "unassigned_visit:";

/** Today's visits with no technician, each told of once; those since given one, moved or called off, closed. */
export async function tellOfUnassignedToday(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
  now: Date,
): Promise<number> {
  const today = indiaDate(now);
  const { results } = await db
    .prepare(
      `SELECT a.id, a.window_start FROM appointments a INDEXED BY appointments_by_technician
       WHERE a.technician_id IS NULL AND a.window_start >= ?1 AND a.window_start < ?2 AND a.deleted_at IS NULL
         AND ${statusIn("a.status", VISIT_NOT_BEGUN)}`,
    )
    .bind(indiaInstant(today, "00:00").toISOString(), indiaInstant(addDays(today, 1), "00:00").toISOString())
    .all<{ id: string; window_start: string }>();
  for (const visit of results) {
    await deps.alertOnce({
      key: `${KEY}${visit.id}`,
      message: `Visit ${visit.id} today has no technician. Send someone from the Dispatch board.`,
      link: "/dispatch",
    });
  }
  const still = new Set(results.map((visit) => visit.id));
  const { results: open } = await db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND key >= ?1 AND key < ?2")
    .bind(KEY, `${KEY.slice(0, -1)};`)
    .all<{ key: string }>();
  for (const { key } of open) {
    if (!still.has(key.slice(KEY.length))) await deps.resolveAlert(key);
  }
  return results.length;
}

/** Each technician's visits still to come and not begun, by their ID: what switching them off leaves with nobody. */
export async function visitsToComeBy(db: D1Database, now: Date): Promise<ReadonlyMap<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT technician_id, COUNT(*) AS visits FROM appointments INDEXED BY appointments_by_technician
       WHERE technician_id IS NOT NULL AND window_start >= ?1 AND deleted_at IS NULL
         AND ${statusIn("status", VISIT_NOT_BEGUN)}
       GROUP BY technician_id`,
    )
    .bind(now.toISOString())
    .all<{ technician_id: string; visits: number }>();
  return new Map(results.map((row) => [row.technician_id, row.visits]));
}
