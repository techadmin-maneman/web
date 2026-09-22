// Who may log in to the client app, and the one-time-code challenges that let
// them (docs/decisions/0030-one-time-codes.md).

import { secretsMatch, saltedHash } from "../lib/hash.ts";
import { attemptsLeft, CODE_TTL_MS, ONE_TIME_CODE } from "../policy/one-time-code.ts";
import type { CodeChannel } from "../providers/codes.ts";

export interface EligiblePerson {
  readonly id: string;
  readonly mobileE164: string;
}

/**
 * "Open to any person with a booked consultation or any later appointment."
 * Until the FSM mirror arrives (P2-M2), a booked consultation is a Phase 1
 * booking with a proposed visit date (ADR 0025, item 16).
 */
export async function findEligiblePerson(db: D1Database, mobileE164: string): Promise<EligiblePerson | null> {
  const row = await db
    .prepare(
      `SELECT p.id FROM people p
       WHERE p.mobile_e164 = ?1 AND p.erased_at IS NULL
         AND EXISTS (SELECT 1 FROM leads l WHERE l.person_id = p.id AND l.proposed_visit_date IS NOT NULL)`,
    )
    .bind(mobileE164)
    .first<{ id: string }>();
  return row === null ? null : { id: row.id, mobileE164 };
}

/** What a code is for: logging in, or proving each of the two numbers in a number change. */
export type ChallengePurpose = "login" | "number_change_old" | "number_change_new";

export interface Challenge {
  readonly id: string;
  readonly personId: string | null;
  readonly channel: CodeChannel;
  readonly createdAt: Date;
  readonly lastSentAt: Date;
  readonly sends: number;
  readonly attempts: number;
  readonly expiresAt: Date;
}

interface ChallengeRow {
  id: string;
  person_id: string | null;
  channel: CodeChannel;
  created_at: string;
  last_sent_at: string;
  sends: number;
  attempts: number;
  expires_at: string;
}

function challengeOf(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    personId: row.person_id,
    channel: row.channel,
    createdAt: new Date(row.created_at),
    lastSentAt: new Date(row.last_sent_at),
    sends: row.sends,
    attempts: row.attempts,
    expiresAt: new Date(row.expires_at),
  };
}

const codeHashOf = (pepper: string, challengeId: string, code: string) => saltedHash(pepper, `${challengeId}:${code}`);

/**
 * A new challenge. With a person, it holds the hash of `code`; without one (a
 * login for a number with no booking) it holds nothing, so no code ever matches.
 */
export async function createChallenge(
  db: D1Database,
  options: {
    personId: string | null;
    code: string;
    pepper: string;
    now: Date;
    purpose?: ChallengePurpose;
    numberChangeId?: string;
  },
): Promise<Challenge> {
  const id = crypto.randomUUID();
  const at = options.now.toISOString();
  const codeHash = options.personId === null ? null : await codeHashOf(options.pepper, id, options.code);
  const row = await db
    .prepare(
      `INSERT INTO otp_challenges
         (id, created_at, person_id, purpose, channel, code_hash, last_sent_at, expires_at, number_change_id)
       VALUES (?1, ?2, ?3, ?4, 'whatsapp', ?5, ?2, ?6, ?7)
       RETURNING id, person_id, channel, created_at, last_sent_at, sends, attempts, expires_at`,
    )
    .bind(
      id,
      at,
      options.personId,
      options.purpose ?? "login",
      codeHash,
      new Date(options.now.getTime() + CODE_TTL_MS).toISOString(),
      options.numberChangeId ?? null,
    )
    .first<ChallengeRow>();
  if (row === null) throw new Error("challenge not written");
  return challengeOf(row);
}

/** A challenge that can still be answered: not expired, verified or void. */
export async function openChallenge(
  db: D1Database,
  id: string,
  now: Date,
  purpose: ChallengePurpose = "login",
): Promise<Challenge | null> {
  const row = await db
    .prepare(
      `SELECT id, person_id, channel, created_at, last_sent_at, sends, attempts, expires_at FROM otp_challenges
       WHERE id = ?1 AND purpose = ?3 AND verified_at IS NULL AND voided_at IS NULL AND expires_at > ?2`,
    )
    .bind(id, now.toISOString(), purpose)
    .first<ChallengeRow>();
  return row === null ? null : challengeOf(row);
}

/** Puts a fresh code on the challenge, as sent by `channel`. The count of wrong attempts carries on. */
export async function replaceCode(
  db: D1Database,
  challenge: Challenge,
  options: { channel: CodeChannel; code: string; pepper: string; now: Date },
): Promise<void> {
  const codeHash = challenge.personId === null ? null : await codeHashOf(options.pepper, challenge.id, options.code);
  await db
    .prepare(
      "UPDATE otp_challenges SET code_hash = ?2, channel = ?3, last_sent_at = ?4, sends = sends + 1 WHERE id = ?1",
    )
    .bind(challenge.id, codeHash, options.channel, options.now.toISOString())
    .run();
}

export type Verification =
  | { readonly outcome: "verified"; readonly personId: string }
  | { readonly outcome: "mismatch"; readonly attemptsLeft: number }
  | { readonly outcome: "closed" };

/**
 * Checks `code`, counting the attempt first, so parallel guesses cannot share
 * one attempt. The fifth wrong code voids the challenge; a right one closes it.
 */
export async function verifyCode(
  db: D1Database,
  options: { challengeId: string; code: string; pepper: string; now: Date; purpose?: ChallengePurpose },
): Promise<Verification> {
  const counted = await db
    .prepare(
      `UPDATE otp_challenges SET attempts = attempts + 1
       WHERE id = ?1 AND purpose = ?4 AND verified_at IS NULL AND voided_at IS NULL AND expires_at > ?2
         AND attempts < ?3
       RETURNING person_id, code_hash, attempts`,
    )
    .bind(
      options.challengeId,
      options.now.toISOString(),
      ONE_TIME_CODE.wrongAttemptsBeforeVoid,
      options.purpose ?? "login",
    )
    .first<{ person_id: string | null; code_hash: string | null; attempts: number }>();
  if (counted === null) return { outcome: "closed" };

  const given = await codeHashOf(options.pepper, options.challengeId, options.code);
  const right = counted.code_hash !== null && (await secretsMatch(given, counted.code_hash));
  if (right && counted.person_id !== null) {
    const closed = await db
      .prepare("UPDATE otp_challenges SET verified_at = ?2 WHERE id = ?1 AND verified_at IS NULL RETURNING id")
      .bind(options.challengeId, options.now.toISOString())
      .first();
    return closed === null ? { outcome: "closed" } : { outcome: "verified", personId: counted.person_id };
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
