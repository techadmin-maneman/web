// Fixed-window counters in D1, for rate limits and daily ceilings.

export interface Limit {
  /** What is being limited, e.g. "lead:mobile". */
  readonly scope: string;
  /** Who is being limited: a salted hash, never a raw number or address. */
  readonly key: string;
  /** Which window this use falls in, e.g. an India date "2026-09-21". */
  readonly window: string;
  readonly limit: number;
}

/**
 * Counts one use. Returns false, and counts nothing, once `limit` uses have
 * been counted in this window. One statement, so concurrent requests cannot
 * both take the last use.
 */
export async function takeOne(db: D1Database, { scope, key, window, limit }: Limit): Promise<boolean> {
  if (limit <= 0) return false;
  const row = await db
    .prepare(
      `INSERT INTO counters (scope, key, window_start, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (scope, key, window_start) DO UPDATE SET count = count + 1 WHERE count < ?4
       RETURNING count`,
    )
    .bind(scope, key, window, limit)
    .first<{ count: number }>();
  return row !== null;
}

/** Counts one more in the window, with no limit, and says how many there are now. */
export async function countOne(db: D1Database, { scope, key, window }: Omit<Limit, "limit">): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO counters (scope, key, window_start, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (scope, key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(scope, key, window)
    .first<{ count: number }>();
  return row?.count ?? 1;
}
