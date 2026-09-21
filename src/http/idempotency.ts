// Idempotency-Key support. A client that retries a request with the same key
// within 24 hours gets the first response back instead of creating a second
// lead. The key is reserved before the work starts, so two simultaneous
// retries cannot both do the work.

const TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyStart =
  /** First time: do the work, then call finish() or abandon(). */
  | { readonly kind: "new" }
  /** Done before: send this stored response again. */
  | { readonly kind: "replay"; readonly status: number; readonly body: unknown }
  /** The first request with this key has not finished yet. */
  | { readonly kind: "in_progress" }
  /** The key was used before with a different request body. */
  | { readonly kind: "key_reused" };

export interface IdempotencyRecord {
  readonly key: string;
  readonly route: string;
  readonly requestHash: string;
}

export async function startIdempotent(db: D1Database, record: IdempotencyRecord, now: Date): Promise<IdempotencyStart> {
  const expiredBefore = new Date(now.getTime() - TTL_MS).toISOString();
  await db
    .prepare("DELETE FROM idempotency WHERE key = ?1 AND route = ?2 AND created_at < ?3")
    .bind(record.key, record.route, expiredBefore)
    .run();

  const reserved = await db
    .prepare(
      `INSERT INTO idempotency (key, route, request_hash, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (key, route) DO NOTHING RETURNING key`,
    )
    .bind(record.key, record.route, record.requestHash, now.toISOString())
    .first();
  if (reserved !== null) return { kind: "new" };

  const existing = await db
    .prepare("SELECT request_hash, response_json FROM idempotency WHERE key = ?1 AND route = ?2")
    .bind(record.key, record.route)
    .first<{ request_hash: string; response_json: string | null }>();
  if (existing === null) return { kind: "in_progress" }; // abandoned between our two statements; the client retries
  if (existing.request_hash !== record.requestHash) return { kind: "key_reused" };
  if (existing.response_json === null) return { kind: "in_progress" };

  const stored = JSON.parse(existing.response_json) as { status: number; body: unknown };
  return { kind: "replay", status: stored.status, body: stored.body };
}

export async function finishIdempotent(
  db: D1Database,
  record: IdempotencyRecord,
  response: { status: number; body: unknown },
): Promise<void> {
  await db
    .prepare("UPDATE idempotency SET response_json = ?3 WHERE key = ?1 AND route = ?2")
    .bind(record.key, record.route, JSON.stringify(response))
    .run();
}

/** Releases the key after a failure, so the client's retry can do the work. */
export async function abandonIdempotent(db: D1Database, record: IdempotencyRecord): Promise<void> {
  await db.prepare("DELETE FROM idempotency WHERE key = ?1 AND route = ?2").bind(record.key, record.route).run();
}
