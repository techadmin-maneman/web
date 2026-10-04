// Who may log in to the client app, and the one-time-code challenges that let
// them (docs/decisions/0030-one-time-codes.md).

import type { CodeChannel } from "../providers/codes.ts";
import {
  CHALLENGE_COLUMNS,
  challengeOf,
  checkCode,
  codeHashOf,
  type Challenge,
  type ChallengePurpose,
  type ChallengeRow,
} from "./one-time-codes.ts";

export interface EligiblePerson {
  readonly id: string;
  readonly mobileE164: string;
  /** Whether this record is one of our own scripts' is read from it (isStagingTestRecord, ADR 0097). */
  readonly name: string;
}

/**
 * "Open to any person with a booked consultation or any later appointment."
 * A booked consultation is a visit, or a Phase 1 booking with a proposed visit
 * date (ADR 0025, item 16).
 */
export async function findEligiblePerson(db: D1Database, mobileE164: string): Promise<EligiblePerson | null> {
  const row = await db
    .prepare(
      `SELECT p.id, p.name FROM people p
       WHERE p.mobile_e164 = ?1 AND p.erased_at IS NULL
         AND (EXISTS (SELECT 1 FROM leads l WHERE l.person_id = p.id AND l.proposed_visit_date IS NOT NULL)
           OR EXISTS (SELECT 1 FROM appointments a WHERE a.person_id = p.id AND a.deleted_at IS NULL))`,
    )
    .bind(mobileE164)
    .first<{ id: string; name: string }>();
  return row === null ? null : { id: row.id, mobileE164, name: row.name };
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
      `SELECT ${CHALLENGE_COLUMNS} FROM otp_challenges
       WHERE id = ?1 AND purpose = ?3 AND technician_login = 0
         AND verified_at IS NULL AND voided_at IS NULL AND expires_at > ?2`,
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
  const codeHash = challenge.holderId === null ? null : await codeHashOf(options.pepper, challenge.id, options.code);
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

/** Checks a client's code (src/domain/one-time-codes.ts): a login's, unless the purpose says otherwise. */
export async function verifyCode(
  db: D1Database,
  options: { challengeId: string; code: string; pepper: string; now: Date; purpose?: ChallengePurpose },
): Promise<Verification> {
  const checked = await checkCode(db, { ...options, purpose: options.purpose ?? "login", holder: "person" });
  return checked.outcome === "verified" ? { outcome: "verified", personId: checked.holderId } : checked;
}
