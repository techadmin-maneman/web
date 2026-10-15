// Global daily ceilings. The render ceiling caps YouCam spend; the upload,
// render and result-read ceilings together cap R2 use within its monthly budget
// (docs/decisions/0194-the-build-on-workers-paid.md); the geocode
// ceiling caps what the address search can spend on the Google account's card
// (docs/decisions/0054-address-capture.md). A breach answers 503 busy and
// alerts, at most once a day per ceiling, and 80% of one alerts once before it.
//
// Each is the figure ops set in Settings · Rules (src/policy/ops-settings-ceilings.ts), read in the statement that
// counts against it, so a ceiling raised on a busy day holds from the next request; until they set one, the
// environment's own figure.

import type { Alert } from "../../providers/alerts.ts";
import { indiaDate } from "../../lib/india-time.ts";
import type { Ceiling } from "../../policy/daily-ceilings.ts";
import { limitOf } from "../../policy/rate-limits.ts";
import { takeOne, type CountedAt } from "../sign-in/rate-limit.ts";

export type { Ceiling } from "../../policy/daily-ceilings.ts";

/** What stops while a ceiling is reached, for its alert. */
const STOPPED: Readonly<Record<Ceiling, string>> = {
  upload: "try-ons",
  render: "try-ons",
  result_read: "try-ons",
  login_code: "the client app's login codes and number changes",
  // Only an active technician's number is sent a code, so clients and strangers cannot spend this one.
  tech_code: "the technician app's login codes",
  // The site's codes go to whatever number is typed, so they have a ceiling of their own and never stop a login.
  form_code: "the site's WhatsApp codes for the one visit and the try-on",
  geocode: "address suggestions",
  route: "the dispatch board's drive times",
  route_map: "the dispatch board's day map",
};

/** The share of a ceiling at which ops are told, once, before it is reached. */
const NEARING_PERCENT = 80;

/** Today's ceiling, as SQL: ?3 the environment's figure and ?4 the ceiling's name. */
const CEILING = `COALESCE((SELECT json_extract(s.value, '$.' || ?4) FROM ops_settings s WHERE s.name = 'daily_ceilings'), ?3)`;

const bindings = (ceiling: Ceiling, at: CountedAt) =>
  [`ceiling:${ceiling}`, indiaDate(at.now), limitOf(`ceiling:${ceiling}`, at.settings), ceiling] as const;

/** Counts one use against today's ceiling: how many now, of how many; null, counting nothing, once it is reached. */
async function countOne(
  db: D1Database,
  ceiling: Ceiling,
  at: CountedAt,
): Promise<{ readonly count: number; readonly of: number } | null> {
  return db
    .prepare(
      `INSERT INTO counters (scope, key, window_start, count) SELECT ?1, 'all', ?2, 1 WHERE ${CEILING} > 0
       ON CONFLICT (scope, key, window_start) DO UPDATE SET count = count + 1 WHERE count < ${CEILING}
       RETURNING count, ${CEILING} AS "of"`,
    )
    .bind(...bindings(ceiling, at))
    .first<{ count: number; of: number }>();
}

/** Counts one use against today's ceiling; false once the ceiling is reached. */
export async function takeFromCeiling(db: D1Database, ceiling: Ceiling, at: CountedAt): Promise<boolean> {
  return (await countOne(db, ceiling, at)) !== null;
}

/** Whether today's ceiling is reached already. Counts nothing. */
export async function ceilingReached(db: D1Database, ceiling: Ceiling, at: CountedAt): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT count FROM counters WHERE scope = ?1 AND key = 'all' AND window_start = ?2), 0)
         >= ${CEILING} AS reached`,
    )
    .bind(...bindings(ceiling, at))
    .first<{ reached: number }>();
  return row?.reached === 1;
}

export async function alertCeilingReached(
  db: D1Database,
  alert: Alert,
  ceiling: Ceiling,
  at: CountedAt,
): Promise<void> {
  if (!(await takeOne(db, "alert:ceiling", ceiling, at))) return;
  const limit = await db
    .prepare(`SELECT ${CEILING} AS "of"`)
    .bind(...bindings(ceiling, at))
    .first<number>("of");
  await alert(
    `The daily ${ceiling} ceiling (${String(limit)}) is reached; ${STOPPED[ceiling]} answer "busy" until midnight ` +
      "IST. Raise it in Settings · Rules if the day calls for more.",
  );
}

/** Counts one use against today's ceiling; false, with one alert a day, once the ceiling is reached. */
export async function withinCeiling(db: D1Database, alert: Alert, ceiling: Ceiling, at: CountedAt): Promise<boolean> {
  const counted = await countOne(db, ceiling, at);
  if (counted === null) {
    await alertCeilingReached(db, alert, ceiling, at);
    return false;
  }
  // The one use that reaches the share, so it is told once however many follow; a ceiling so small that this is its
  // last is told only once reached.
  const nearing = Math.ceil((counted.of * NEARING_PERCENT) / 100);
  if (counted.count === nearing && nearing < counted.of) {
    await alert(
      `The daily ${ceiling} ceiling is ${String(NEARING_PERCENT)}% used (${String(counted.count)} of ` +
        `${String(counted.of)}); raise it in Settings · Rules before ${STOPPED[ceiling]} answer "busy" until midnight IST.`,
    );
  }
  return true;
}
