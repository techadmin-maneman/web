// How far along a client is, as the console shows it (docs/decisions/0307-the-people-rulings.md): a lead until a
// visit of theirs is done; consulted once a consultation is; fitted once a first fit, service or replacement is; and
// active while the last of those is within their package's service cadence and the grace the At-risk client task
// gives, as the retention figures count it (src/policy/client-standing.ts).

import { everyDaysSql } from "../booking/packages.ts";

export const CLIENT_STAGES = ["lead", "consulted", "fitted", "active"] as const;
export type ClientStage = (typeof CLIENT_STAGES)[number];

/** What a client's stage is read against: the At-risk client task's grace, and India's date today. */
export interface StageDays {
  readonly grace: number;
  readonly today: string;
}

/**
 * The client `alias` names's stage, in SQL, with the grace and today as the parameters given. The last fitting is read
 * once, and the consultation only of those never fitted.
 */
export const stageSql = (alias: string, grace: string, today: string): string => `(SELECT CASE
    WHEN last.fitted IS NULL THEN
      CASE WHEN EXISTS (SELECT 1 FROM appointments c
        WHERE c.person_id = ${alias}.id AND c.deleted_at IS NULL AND c.status = 'completed' AND c.type = 'consultation'
          AND c.window_start IS NOT NULL AND c.window_end IS NOT NULL) THEN 'consulted' ELSE 'lead' END
    WHEN date(last.fitted, '+330 minutes', '+' || (${everyDaysSql(`${alias}.package`)} + ${grace} + 1) || ' days')
      > ${today} THEN 'active'
    ELSE 'fitted' END
  FROM (SELECT MAX(a.window_start) AS fitted FROM appointments a
    WHERE a.person_id = ${alias}.id AND a.deleted_at IS NULL AND a.status = 'completed'
      AND a.window_start IS NOT NULL AND a.window_end IS NOT NULL
      AND a.type IN ('first_fit', 'service', 'replacement')) last)`;

/** One client's stage. */
export async function clientStage(db: D1Database, personId: string, days: StageDays): Promise<ClientStage> {
  const row = await db
    .prepare(`SELECT ${stageSql("client", "?2", "?3")} AS stage FROM people client WHERE client.id = ?1`)
    .bind(personId, days.grace, days.today)
    .first<{ stage: ClientStage }>();
  return row?.stage ?? "lead";
}
