// Checking a one-time code (src/policy/one-time-code.ts; docs/decisions/0030-one-time-codes.md): the one check
// behind a client's login, a technician's and a number change's. A challenge keeps only the code's hash. A client's
// challenges are made in src/domain/login.ts, a technician's in src/domain/technicians.ts; the two never answer
// for each other.

import { saltedHash, secretsMatch } from "../lib/hash.ts";
import { attemptsLeft, ONE_TIME_CODE } from "../policy/one-time-code.ts";

/** What a challenge stores instead of the code. */
export const codeHashOf = (pepper: string, challengeId: string, code: string) =>
  saltedHash(pepper, `${challengeId}:${code}`);

/** What a code is for: logging in, or proving each of the two numbers in a number change. */
export type ChallengePurpose = "login" | "number_change_old" | "number_change_new";

/** Whose challenge it is: a client's, kept by person, or a technician's, kept by technician. */
export type ChallengeHolder = "person" | "technician";

export type CodeCheck =
  | { readonly outcome: "verified"; readonly holderId: string }
  | { readonly outcome: "mismatch"; readonly attemptsLeft: number }
  | { readonly outcome: "closed" };

interface Counted {
  person_id: string | null;
  technician_id: string | null;
  code_hash: string | null;
  attempts: number;
}

/**
 * Checks `code`, counting the attempt first, so parallel guesses cannot share
 * one attempt. The fifth wrong code voids the challenge; a right one closes it.
 * A challenge made for nobody holds no hash, so no code matches it.
 */
export async function checkCode(
  db: D1Database,
  options: {
    challengeId: string;
    code: string;
    pepper: string;
    now: Date;
    purpose: ChallengePurpose;
    holder: ChallengeHolder;
  },
): Promise<CodeCheck> {
  const counted = await db
    .prepare(
      `UPDATE otp_challenges SET attempts = attempts + 1
       WHERE id = ?1 AND purpose = ?4 AND technician_login = ?5
         AND verified_at IS NULL AND voided_at IS NULL AND expires_at > ?2 AND attempts < ?3
       RETURNING person_id, technician_id, code_hash, attempts`,
    )
    .bind(
      options.challengeId,
      options.now.toISOString(),
      ONE_TIME_CODE.wrongAttemptsBeforeVoid,
      options.purpose,
      options.holder === "technician" ? 1 : 0,
    )
    .first<Counted>();
  if (counted === null) return { outcome: "closed" };

  const holderId = options.holder === "technician" ? counted.technician_id : counted.person_id;
  const given = await codeHashOf(options.pepper, options.challengeId, options.code);
  if (holderId !== null && counted.code_hash !== null && (await secretsMatch(given, counted.code_hash))) {
    const closed = await db
      .prepare("UPDATE otp_challenges SET verified_at = ?2 WHERE id = ?1 AND verified_at IS NULL RETURNING id")
      .bind(options.challengeId, options.now.toISOString())
      .first();
    return closed === null ? { outcome: "closed" } : { outcome: "verified", holderId };
  }

  const left = attemptsLeft(counted.attempts);
  if (left === 0) {
    await db
      .prepare("UPDATE otp_challenges SET voided_at = ?2 WHERE id = ?1")
      .bind(options.challengeId, options.now.toISOString())
      .run();
  }
  return { outcome: "mismatch", attemptsLeft: left };
}
