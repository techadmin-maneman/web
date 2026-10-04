// One-time codes (src/policy/one-time-code.ts): the challenge made and the one check behind a client's login, a
// technician's and a number change's. A challenge keeps only the code's hash, and a client's and a technician's never
// answer for each other.

import { saltedHash, secretsMatch } from "../lib/hash.ts";
import { attemptsLeft, CODE_TTL_MS, ONE_TIME_CODE } from "../policy/one-time-code.ts";
import type { CodeChannel } from "../providers/codes.ts";

/** What a challenge stores instead of the code. */
export const codeHashOf = (pepper: string, challengeId: string, code: string) =>
  saltedHash(pepper, `${challengeId}:${code}`);

/** What a code is for: logging in, or proving each of the two numbers in a number change. */
export type ChallengePurpose = "login" | "number_change_old" | "number_change_new";

/** Whose challenge it is: a client's, kept by person, or a technician's, kept by technician. */
export type ChallengeHolder = "person" | "technician";

export interface Challenge {
  readonly id: string;
  /** The client's or the technician's ID; null for a number that is no one's, whose challenge holds no code. */
  readonly holderId: string | null;
  /** The hash a client's login was asked for under (mobileHashOf), whoever holds the number; null on any other. */
  readonly mobileHash: string | null;
  readonly channel: CodeChannel;
  readonly createdAt: Date;
  readonly lastSentAt: Date;
  readonly sends: number;
  readonly attempts: number;
  readonly expiresAt: Date;
}

/** The columns a Challenge is read from. A row has a person or a technician, never both. */
export const CHALLENGE_COLUMNS =
  "id, COALESCE(person_id, technician_id) AS holder_id, mobile_hash, channel, created_at, last_sent_at, sends, " +
  "attempts, expires_at";

export interface ChallengeRow {
  id: string;
  holder_id: string | null;
  mobile_hash: string | null;
  channel: CodeChannel;
  created_at: string;
  last_sent_at: string;
  sends: number;
  attempts: number;
  expires_at: string;
}

export function challengeOf(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    holderId: row.holder_id,
    mobileHash: row.mobile_hash,
    channel: row.channel,
    createdAt: new Date(row.created_at),
    lastSentAt: new Date(row.last_sent_at),
    sends: row.sends,
    attempts: row.attempts,
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * A new challenge, sent on WhatsApp. With a holder it keeps the hash of `code`; without one (a number that is no
 * one's) it keeps nothing, so no code ever matches and the screen answers the same either way.
 */
export async function createChallenge(
  db: D1Database,
  options: {
    holder: ChallengeHolder;
    holderId: string | null;
    code: string;
    pepper: string;
    now: Date;
    purpose?: ChallengePurpose;
    numberChangeId?: string;
    /** A client's login keeps the number's hash, so a code sent again counts against the number's day. */
    mobileHash?: string;
  },
): Promise<Challenge> {
  const id = crypto.randomUUID();
  const at = options.now.toISOString();
  const isTechnician = options.holder === "technician";
  const personId = isTechnician ? null : options.holderId;
  const technicianId = isTechnician ? options.holderId : null;
  const codeHash = options.holderId === null ? null : await codeHashOf(options.pepper, id, options.code);
  const row = await db
    .prepare(
      `INSERT INTO otp_challenges
         (id, created_at, person_id, technician_login, technician_id, purpose, channel, code_hash, last_sent_at,
          expires_at, number_change_id, mobile_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'whatsapp', ?7, ?2, ?8, ?9, ?10)
       RETURNING ${CHALLENGE_COLUMNS}`,
    )
    .bind(
      id,
      at,
      personId,
      isTechnician ? 1 : 0,
      technicianId,
      options.purpose ?? "login",
      codeHash,
      new Date(options.now.getTime() + CODE_TTL_MS).toISOString(),
      options.numberChangeId ?? null,
      options.mobileHash ?? null,
    )
    .first<ChallengeRow>();
  if (row === null) throw new Error("challenge not written");
  return challengeOf(row);
}

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
export async function checkLoginCode(
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
