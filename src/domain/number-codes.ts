// The WhatsApp code that proves a number typed into the site (src/policy/number-proof.ts). Only hashes are kept: the
// number as the rate limits key it, and the code as a login code's is (src/domain/one-time-codes.ts).

import { saltedHash, secretsMatch } from "../lib/hash.ts";
import { stillProved } from "../policy/number-proof.ts";
import { attemptsLeft, CODE_TTL_MS, ONE_TIME_CODE } from "../policy/one-time-code.ts";
import { codeHashOf } from "./one-time-codes.ts";

/** The number as a code keeps it, and as the rate limits key it. */
export const mobileHashOf = (salt: string, mobileE164: string) => saltedHash(salt, `mobile:${mobileE164}`);

/** A new code for the number with this hash. Returns its ID. */
export async function createNumberCode(
  db: D1Database,
  options: { mobileHash: string; code: string; pepper: string; now: Date },
): Promise<string> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(options.now.getTime() + CODE_TTL_MS);
  await db
    .prepare(
      `INSERT INTO number_codes (id, created_at, mobile_hash, code_hash, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      id,
      options.now.toISOString(),
      options.mobileHash,
      await codeHashOf(options.pepper, id, options.code),
      expiresAt.toISOString(),
    )
    .run();
  return id;
}

export type NumberCodeCheck =
  | { readonly outcome: "verified" }
  | { readonly outcome: "mismatch"; readonly attemptsLeft: number }
  | { readonly outcome: "closed" };

/**
 * Checks `code`, counting the attempt first, so parallel guesses cannot share one attempt. The fifth wrong code voids
 * it; the right one proves its number. One already entered, expired or void is closed.
 */
export async function checkNumberCode(
  db: D1Database,
  options: { id: string; code: string; pepper: string; now: Date },
): Promise<NumberCodeCheck> {
  const at = options.now.toISOString();
  const counted = await db
    .prepare(
      `UPDATE number_codes SET attempts = attempts + 1
       WHERE id = ?1 AND verified_at IS NULL AND voided_at IS NULL AND expires_at > ?2 AND attempts < ?3
       RETURNING code_hash, attempts`,
    )
    .bind(options.id, at, ONE_TIME_CODE.wrongAttemptsBeforeVoid)
    .first<{ code_hash: string; attempts: number }>();
  if (counted === null) return { outcome: "closed" };

  const given = await codeHashOf(options.pepper, options.id, options.code);
  if (await secretsMatch(given, counted.code_hash)) {
    await db.prepare("UPDATE number_codes SET verified_at = ?2 WHERE id = ?1").bind(options.id, at).run();
    return { outcome: "verified" };
  }

  const left = attemptsLeft(counted.attempts);
  if (left === 0) {
    await db.prepare("UPDATE number_codes SET voided_at = ?2 WHERE id = ?1").bind(options.id, at).run();
  }
  return { outcome: "mismatch", attemptsLeft: left };
}

/** Whether the code `id` was entered for the number with this hash, recently enough to prove it still. */
export async function numberProved(
  db: D1Database,
  options: { id: string; mobileHash: string; now: Date },
): Promise<boolean> {
  const row = await db
    .prepare("SELECT verified_at FROM number_codes WHERE id = ?1 AND mobile_hash = ?2 AND verified_at IS NOT NULL")
    .bind(options.id, options.mobileHash)
    .first<{ verified_at: string }>();
  if (row === null) return false;
  return stillProved(new Date(row.verified_at), options.now);
}
