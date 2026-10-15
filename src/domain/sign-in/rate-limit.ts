// Fixed-window counters in D1, for the limits and daily ceilings in src/policy/rate-limits.ts, and the counts a few
// alerts are raised from. Each works out its own window, India's day or hour, from the scope's.

import type { Settings } from "../../config/settings.ts";
import { indiaDate, indiaHour } from "../../lib/india-time.ts";
import {
  COUNTERS,
  limitOf,
  RATE_LIMITS,
  type Counter,
  type Period,
  type RateLimitScope,
} from "../../policy/rate-limits.ts";

/** When a use is counted, and the settings a limit may be read from. */
export interface CountedAt {
  readonly now: Date;
  readonly settings: Settings;
}

const windowOf = (per: Period, now: Date): string => (per === "day" ? indiaDate(now) : indiaHour(now));

/**
 * Counts one use by `key`: a salted hash, a person's ID or "all", never a raw number or address. Returns false, and
 * counts nothing, once the scope's limit is reached in this window. One statement, so concurrent requests cannot both
 * take the last use.
 */
export async function takeOne(db: D1Database, scope: RateLimitScope, key: string, at: CountedAt): Promise<boolean> {
  const limit = limitOf(scope, at.settings);
  if (limit <= 0) return false;
  const row = await db
    .prepare(
      `INSERT INTO counters (scope, key, window_start, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (scope, key, window_start) DO UPDATE SET count = count + 1 WHERE count < ?4
       RETURNING count`,
    )
    .bind(scope, key, windowOf(RATE_LIMITS[scope].per, at.now), limit)
    .first<{ count: number }>();
  return row !== null;
}

/** Whether the scope's limit is reached in this window already. Counts nothing. */
export async function isSpent(db: D1Database, scope: RateLimitScope, key: string, at: CountedAt): Promise<boolean> {
  const row = await db
    .prepare("SELECT count FROM counters WHERE scope = ?1 AND key = ?2 AND window_start = ?3")
    .bind(scope, key, windowOf(RATE_LIMITS[scope].per, at.now))
    .first<{ count: number }>();
  return (row?.count ?? 0) >= limitOf(scope, at.settings);
}

/** Which of these keys have reached the scope's limit in this window already. Counts nothing. */
export async function spentAmong(
  db: D1Database,
  scope: RateLimitScope,
  keys: readonly string[],
  at: CountedAt,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT key FROM counters WHERE scope = ?1 AND window_start = ?2 AND count >= ?3
         AND key IN (SELECT value FROM json_each(?4))`,
    )
    .bind(scope, windowOf(RATE_LIMITS[scope].per, at.now), limitOf(scope, at.settings), JSON.stringify(keys))
    .all<{ key: string }>();
  return new Set(results.map((row) => row.key));
}

/** Gives back every use `key` has had in this window, so the limit stops it again only once it is reached anew. */
export const forgetUses = (db: D1Database, scope: RateLimitScope, key: string, now: Date): D1PreparedStatement =>
  db
    .prepare("DELETE FROM counters WHERE scope = ?1 AND key = ?2 AND window_start = ?3")
    .bind(scope, key, windowOf(RATE_LIMITS[scope].per, now));

/** Counts one more in the window, with no limit, and says how many there are now. */
export async function countOne(db: D1Database, counter: Counter, key: string, now: Date): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO counters (scope, key, window_start, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (scope, key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(counter, key, windowOf(COUNTERS[counter].per, now))
    .first<{ count: number }>();
  return row?.count ?? 1;
}
