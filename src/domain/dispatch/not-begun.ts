// A visit its technician has not begun once its arrival window is over (docs/decisions/0277-alerts-that-come-sooner.md):
// today's, with a technician, and no check-in of theirs that passed. The client is waiting at home, so ops hear of it
// at once, on Tasks and in the alert space, and call the technician and the client. A check-in, a close or a cancel
// puts it right; once the day is over, a visit still open is Tasks' "Visit left open" instead (./unassigned.ts).

import { statusIn, VISIT_LIVE, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import { indiaClock } from "@maneman/web-kit/dates";
import type { AlertOnce } from "../platform/alerts.ts";
import type { SqlValue } from "../../lib/sql.ts";
import type { TaskGroup } from "../../policy/tasks.ts";
import { UNASSIGNED_VISITS, VISITS_LEFT_OPEN } from "./unassigned.ts";

/** An alert's key for a visit not begun; its kind is "visit_not_begun". */
const visitNotBegunKey = (visitId: string): string => `visit_not_begun:${visitId}`;

/**
 * The Tasks board's visits not begun past their arrival window. Each waits from the window's end. `?1` is now, `?2`
 * the arrival window's minutes, `?3` the start of today.
 */
const VISITS_NOT_BEGUN = `SELECT 'visit_not_begun' AS "group", a.id AS id, pe.id AS person_id,
         pe.name AS person_name, a.window_start AS detail,
         json_object('kind', a.type, 'starts_at', a.window_start, 'technician', COALESCE(t.name, '')) AS facts,
         strftime('%Y-%m-%dT%H:%M:%fZ', a.window_start, '+' || ?2 || ' minutes') AS since, NULL AS due_by,
         '' AS episode
    FROM appointments a INDEXED BY appointments_live_by_start
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
    LEFT JOIN technicians t ON t.id = a.technician_id
   WHERE ${statusIn("a.status", VISIT_LIVE)} AND a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)}
     AND a.technician_id IS NOT NULL
     AND a.window_start >= ?3 AND a.window_start <= strftime('%Y-%m-%dT%H:%M:%fZ', ?1, '-' || ?2 || ' minutes')
     AND NOT EXISTS (SELECT 1 FROM checkins c INDEXED BY checkins_by_appointment
                       JOIN job_events e ON e.id = c.job_event_id
                      WHERE c.appointment_id = a.id AND c.technician_id = a.technician_id AND c.passed = 1
                        AND e.superseded = 0)
     AND NOT EXISTS (SELECT 1 FROM no_show_cases n WHERE n.appointment_id = a.id)`;

/** What the board's visit queues are read at: now, the start of today, and the arrival window's minutes. */
interface VisitsReadAt {
  readonly now: string;
  readonly todayStarts: string;
  readonly arrival: number;
}

/**
 * The Tasks board's queues of the day's visits: one with no technician, due the day before it; one not begun past its
 * arrival window; and one still open once its day is over (./unassigned.ts).
 */
export const VISIT_QUEUES: readonly {
  readonly group: TaskGroup;
  readonly sql: string;
  readonly binds: (at: VisitsReadAt) => readonly SqlValue[];
}[] = [
  { group: "unassigned_visit", sql: UNASSIGNED_VISITS, binds: (at) => [at.now] },
  { group: "visit_not_begun", sql: VISITS_NOT_BEGUN, binds: (at) => [at.now, at.arrival, at.todayStarts] },
  { group: "visit_left_open", sql: VISITS_LEFT_OPEN, binds: (at) => [at.todayStarts] },
];

/**
 * Tells ops of each visit not begun past its arrival window, once, and closes the alert of each that has since begun,
 * closed or been called off. Run every five minutes by the cron. Answers how many are open.
 */
export async function alertVisitsNotBegun(
  db: D1Database,
  alertOnce: AlertOnce,
  { now, todayStarts, arrival }: { readonly now: Date; readonly todayStarts: string; readonly arrival: number },
): Promise<number> {
  const { results } = await db
    // A script's test record, its client or its technician, pages nobody.
    .prepare(
      `SELECT q.id, q.detail AS starts_at FROM (${VISITS_NOT_BEGUN}) q
         JOIN appointments a ON a.id = q.id
         LEFT JOIN people pe ON pe.id = a.person_id
         LEFT JOIN technicians t ON t.id = a.technician_id
        WHERE COALESCE(pe.test_record, 0) = 0 AND COALESCE(t.test_record, 0) = 0`,
    )
    .bind(now.toISOString(), arrival, todayStarts)
    .all<{ id: string; starts_at: string }>();
  for (const visit of results) {
    await alertOnce({
      key: visitNotBegunKey(visit.id),
      message: ALERT_WORDS.visit_not_begun({ visit: visit.id, start: indiaClock(visit.starts_at), arrival }),
      link: "/dispatch",
    });
  }
  const open = results.map((visit) => visitNotBegunKey(visit.id));
  await db
    .prepare(
      `UPDATE alerts SET resolved_at = ?1
        WHERE key >= 'visit_not_begun:' AND key < 'visit_not_begun;' AND resolved_at IS NULL
          AND key NOT IN (SELECT value FROM json_each(?2))`,
    )
    .bind(now.toISOString(), JSON.stringify(open))
    .run();
  return results.length;
}
