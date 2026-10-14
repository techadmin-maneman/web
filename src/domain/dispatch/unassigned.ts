// A visit today with no technician: the Tasks board raised it the day before; on its day ops are told, once, until
// someone is sent or the visit is moved or called off. And each technician's visits to come, which switching them off
// would leave with nobody.

import { addDays, INDIA_OFFSET_MINUTES, indiaDate, indiaDateSql, indiaInstant } from "../../lib/india-time.ts";
import { statusIn, VISIT_LIVE, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import type { AlertOnce, ResolveAlert } from "../platform/alerts.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";

const KEY = "unassigned_visit:";

/** Today's visits with no technician, each told of once; those since given one, moved or called off, closed. */
export async function tellOfUnassignedToday(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert; readonly now: () => Date },
): Promise<void> {
  const today = indiaDate(deps.now());
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
      message: ALERT_WORDS.unassigned_visit({ visit: visit.id }),
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

/**
 * The Tasks board's visits with no technician, as a switch-off leaves its jobs: someone must be sent. Each waits from
 * when it last changed, and falls due the day before it. `?1` is now.
 */
export const UNASSIGNED_VISITS = `SELECT 'unassigned_visit' AS "group", a.id AS id, pe.id AS person_id, pe.name AS person_name,
         a.type || ' ' || a.window_start AS detail, json_object('kind', a.type, 'starts_at', a.window_start) AS facts,
         a.synced_at AS since,
         strftime('%Y-%m-%dT%H:%M:%fZ', a.window_start, '-1 day') AS due_by, '' AS episode
    FROM appointments a INDEXED BY appointments_by_technician
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
   WHERE a.technician_id IS NULL AND a.window_start >= ?1 AND a.deleted_at IS NULL
     AND ${statusIn("a.status", VISIT_NOT_BEGUN)}`;

/**
 * The Tasks board's visits still open once their day is over in India: nobody came, or one was never closed. Each
 * waits from the midnight after its day; a no-show is its own group. `?1` is the start of today.
 */
export const VISITS_LEFT_OPEN = `SELECT 'visit_left_open' AS "group", a.id AS id, pe.id AS person_id, pe.name AS person_name,
         a.status || ' ' || a.window_start AS detail,
         json_object('status', a.status, 'starts_at', a.window_start) AS facts,
         strftime('%Y-%m-%dT%H:%M:%fZ', ${indiaDateSql("a.window_start", "'+1 day'")}, '-${String(INDIA_OFFSET_MINUTES)} minutes') AS since,
         NULL AS due_by, '' AS episode
    FROM appointments a INDEXED BY appointments_live_by_start
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
   WHERE ${statusIn("a.status", VISIT_LIVE)} AND a.deleted_at IS NULL AND a.window_start < ?1
     AND NOT EXISTS (SELECT 1 FROM no_show_cases n WHERE n.appointment_id = a.id)`;
