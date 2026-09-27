// Idempotency-Key support (docs/decisions/0011-lead-api.md). A client that retries a request with the same key
// within 24 hours gets the first response back instead of creating a second lead or booking. The key is reserved
// before the work starts, so two simultaneous retries cannot both do the work.

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { sha256Hex } from "../lib/hash.ts";
import { DAY_MS } from "../lib/durations.ts";

const TTL_MS = DAY_MS;

/** The optional header a client names one submission with, so sending it again is answered, not done twice. */
export const IdempotencyKeyHeaderSchema = z.object({ "idempotency-key": z.string().min(8).max(200).optional() });

type IdempotencyStart =
  /** First time: do the work, then finish or abandon the key. */
  | { readonly kind: "new" }
  /** Done before: send this stored response again. */
  | { readonly kind: "replay"; readonly body: unknown }
  /** The first request with this key has not finished yet. */
  | { readonly kind: "in_progress" }
  /** The key was used before with a different request body. */
  | { readonly kind: "key_reused" };

interface IdempotencyRecord {
  readonly key: string;
  readonly route: string;
  readonly requestHash: string;
}

async function startIdempotent(db: D1Database, record: IdempotencyRecord, now: Date): Promise<IdempotencyStart> {
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
  return { kind: "replay", body: stored.body };
}

/** Every keyed route answers its success with a 201, which is kept beside the body. */
async function finishIdempotent(db: D1Database, record: IdempotencyRecord, body: unknown): Promise<void> {
  await db
    .prepare("UPDATE idempotency SET response_json = ?3 WHERE key = ?1 AND route = ?2")
    .bind(record.key, record.route, JSON.stringify({ status: 201, body }))
    .run();
}

/** Releases the key after a failure, so the client's retry can do the work. */
async function abandonIdempotent(db: D1Database, record: IdempotencyRecord): Promise<void> {
  await db.prepare("DELETE FROM idempotency WHERE key = ?1 AND route = ?2").bind(record.key, record.route).run();
}

/** What a keyed handler's work comes to: a success with the body it answers, or a refusal. */
type Outcome = { readonly ok: true; readonly body: unknown } | { readonly ok: false };
type Success<O extends Outcome> = Extract<O, { readonly ok: true }>;

const succeeded = <O extends Outcome>(outcome: O): outcome is Success<O> => outcome.ok;

/** What a keyed request came to. */
export type KeyedRun<O extends Outcome> =
  /** The key was used before for this same request: its first success, to answer again. */
  | { readonly kind: "replay"; readonly body: Success<O>["body"] }
  /** The first request with this key is still running. */
  | { readonly kind: "in_progress" }
  /** The key came before with a different request. */
  | { readonly kind: "key_reused" }
  /** The work ran now. */
  | { readonly kind: "ran"; readonly outcome: O };

/**
 * Runs `work` once for the request's Idempotency-Key. Only a success is kept and answered again: a refusal, or a
 * throw, frees the key, so a retry with a fresh Turnstile token can succeed. Without a key the work just runs.
 */
export async function onceForKey<O extends Outcome>(
  c: Context<AppEnv>,
  keyed: { readonly route: string; readonly key: string | undefined; readonly request: unknown },
  work: () => Promise<O>,
): Promise<KeyedRun<O>> {
  if (keyed.key === undefined) return { kind: "ran", outcome: await work() };

  const db = c.env.DB;
  const record = { key: keyed.key, route: keyed.route, requestHash: await sha256Hex(JSON.stringify(keyed.request)) };
  const start = await startIdempotent(db, record, c.var.deps.now());
  if (start.kind === "replay") return { kind: "replay", body: start.body as Success<O>["body"] };
  if (start.kind !== "new") return { kind: start.kind };

  let outcome: O;
  try {
    outcome = await work();
  } catch (error) {
    await abandonIdempotent(db, record);
    throw error;
  }
  if (succeeded(outcome)) await finishIdempotent(db, record, outcome.body);
  else await abandonIdempotent(db, record);
  return { kind: "ran", outcome };
}
