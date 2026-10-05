// Changing a client's mobile number: a code goes to both numbers, and the change waits for ops to confirm it and
// takes effect only then. Each number's code is its own challenge.

import type { PlacesReached } from "../policy/access.ts";
import { DECISION_SHOWN_DAYS } from "../policy/decision-reasons.ts";
import { newLoginCode } from "../policy/one-time-code.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { verifyCode, type Verification } from "./login.ts";
import { createChallenge, type Challenge, type ChallengePurpose } from "./one-time-codes.ts";
import { reachBinding, withinReach } from "./places.ts";
import { DAY_MS } from "../lib/durations.ts";
import { failedUniqueOn } from "../lib/d1-errors.ts";
import { revokeOthersStatement } from "./sessions.ts";

export type NumberChangeState = "verifying" | "awaiting_ops" | "confirmed" | "rejected" | "withdrawn";
type WhichNumber = "old" | "new";

export interface NumberChange {
  readonly id: string;
  readonly personId: string;
  readonly newMobileE164: string;
  readonly state: NumberChangeState;
  readonly oldVerified: boolean;
  readonly newVerified: boolean;
  readonly createdAt: string;
  /** The session that asked; null for a change asked for before it was kept. */
  readonly sessionId: string | null;
}

interface Row {
  id: string;
  person_id: string;
  new_mobile_e164: string;
  state: NumberChangeState;
  old_verified_at: string | null;
  new_verified_at: string | null;
  created_at: string;
  session_id: string | null;
}

const COLUMNS = "id, person_id, new_mobile_e164, state, old_verified_at, new_verified_at, created_at, session_id";

function changeOf(row: Row): NumberChange {
  return {
    id: row.id,
    personId: row.person_id,
    newMobileE164: row.new_mobile_e164,
    state: row.state,
    oldVerified: row.old_verified_at !== null,
    newVerified: row.new_verified_at !== null,
    createdAt: row.created_at,
    sessionId: row.session_id,
  };
}

const PURPOSE: Readonly<Record<WhichNumber, ChallengePurpose>> = {
  old: "number_change_old",
  new: "number_change_new",
};

/** The client's change still under way: its codes being entered, or waiting for ops. */
export async function openNumberChange(db: D1Database, personId: string): Promise<NumberChange | null> {
  const row = await db
    .prepare(
      `SELECT ${COLUMNS} FROM number_change_requests
       WHERE person_id = ?1 AND state IN ('verifying', 'awaiting_ops') ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<Row>();
  return row === null ? null : changeOf(row);
}

interface DecidedChange {
  readonly state: "confirmed" | "rejected";
  readonly newMobileE164: string;
  readonly decidedAt: string;
  /** Ops' reason, which the client is shown: given for a rejection, none for a confirmation. */
  readonly reason: string | null;
}

/**
 * The client's latest change ops decided, within DECISION_SHOWN_DAYS, so the profile can say what became of it
 * rather than let it vanish. The profile shows it only while no change is under way.
 */
export async function lastDecidedChange(db: D1Database, personId: string, now: Date): Promise<DecidedChange | null> {
  const since = new Date(now.getTime() - DECISION_SHOWN_DAYS * DAY_MS).toISOString();
  const row = await db
    .prepare(
      `SELECT state, new_mobile_e164, decided_at, reason FROM number_change_requests
       WHERE person_id = ?1 AND state IN ('confirmed', 'rejected') AND decided_at >= ?2
       ORDER BY decided_at DESC LIMIT 1`,
    )
    .bind(personId, since)
    .first<{ state: "confirmed" | "rejected"; new_mobile_e164: string; decided_at: string; reason: string | null }>();
  if (row === null) return null;
  return {
    state: row.state,
    newMobileE164: row.new_mobile_e164,
    decidedAt: row.decided_at,
    reason: row.state === "rejected" ? row.reason : null,
  };
}

async function findNumberChange(db: D1Database, id: string): Promise<NumberChange | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM number_change_requests WHERE id = ?1`).bind(id).first<Row>();
  return row === null ? null : changeOf(row);
}

interface StartedChange {
  readonly change: NumberChange;
  readonly codes: Readonly<Record<WhichNumber, { readonly challenge: Challenge; readonly code: string }>>;
}

/** Starts a change, withdrawing any the client had under way, with a code for each number. */
export async function startNumberChange(
  db: D1Database,
  options: {
    personId: string;
    /** The session asking, which a confirmed change leaves signed in. */
    sessionId: string;
    newMobileE164: string;
    pepper: string;
    /** The request's audit entry, written with the change it names (src/domain/audit.ts). */
    audit: AuditEntry;
    now: Date;
    /** The code each number gets in place of a random one, where there is one (knownCode). */
    knownCodes?: { readonly old: string | null; readonly new: string | null };
  },
): Promise<StartedChange> {
  const id = crypto.randomUUID();
  const at = options.now.toISOString();
  await db.batch([
    auditStatement(db, { ...options.audit, subject: { kind: "number_change", id } }, options.now),
    db
      .prepare(
        `UPDATE number_change_requests SET state = 'withdrawn', decided_at = ?2
         WHERE person_id = ?1 AND state IN ('verifying', 'awaiting_ops')`,
      )
      .bind(options.personId, at),
    db
      .prepare(
        `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state, session_id)
         VALUES (?1, ?2, ?3, ?4, 'verifying', ?5)`,
      )
      .bind(id, options.personId, at, options.newMobileE164, options.sessionId),
  ]);

  const codeFor = async (which: WhichNumber) => {
    const code = options.knownCodes?.[which] ?? newLoginCode();
    const challenge = await createChallenge(db, {
      holder: "person",
      holderId: options.personId,
      code,
      pepper: options.pepper,
      now: options.now,
      purpose: PURPOSE[which],
      numberChangeId: id,
    });
    return { challenge, code };
  };
  const change = await findNumberChange(db, id);
  if (change === null) throw new Error("number change not written");
  return { change, codes: { old: await codeFor("old"), new: await codeFor("new") } };
}

/**
 * The client withdraws the change they have under way, before ops decide it.
 * Audited only when there was one: a second withdrawal finds nothing and
 * records nothing.
 */
export async function withdrawNumberChange(
  db: D1Database,
  options: { personId: string; audit: AuditEntry; now: Date },
): Promise<void> {
  const open = await openNumberChange(db, options.personId);
  if (open === null) return;
  await db.batch([
    auditStatement(db, { ...options.audit, subject: { kind: "number_change", id: open.id } }, options.now),
    db
      .prepare(
        `UPDATE number_change_requests SET state = 'withdrawn', decided_at = ?2
         WHERE id = ?1 AND state IN ('verifying', 'awaiting_ops')`,
      )
      .bind(open.id, options.now.toISOString()),
  ]);
}

/**
 * Checks one number's code. Once both numbers are proven, the change waits
 * for ops. A code for a change that is no longer being verified is closed.
 */
export async function verifyNumberChange(
  db: D1Database,
  options: { change: NumberChange; which: WhichNumber; code: string; pepper: string; now: Date },
): Promise<{ verification: Verification; change: NumberChange }> {
  const { change, which } = options;
  const challengeId =
    change.state === "verifying"
      ? await db
          .prepare(
            `SELECT id FROM otp_challenges WHERE number_change_id = ?1 AND purpose = ?2
             ORDER BY created_at DESC LIMIT 1`,
          )
          .bind(change.id, PURPOSE[which])
          .first<string>("id")
      : null;
  if (challengeId === null) return { verification: { outcome: "closed" }, change };

  const verification = await verifyCode(db, {
    challengeId,
    code: options.code,
    pepper: options.pepper,
    now: options.now,
    purpose: PURPOSE[which],
  });
  if (verification.outcome === "verified") {
    // Proven now, and the other number proven already: over to ops.
    const [proven, other] =
      which === "old" ? ["old_verified_at", "new_verified_at"] : ["new_verified_at", "old_verified_at"];
    await db
      .prepare(
        `UPDATE number_change_requests SET ${proven} = ?2,
           state = CASE WHEN ${other} IS NOT NULL THEN 'awaiting_ops' ELSE state END
         WHERE id = ?1 AND state = 'verifying'`,
      )
      .bind(change.id, options.now.toISOString())
      .run();
  }
  return { verification, change: (await findNumberChange(db, change.id)) ?? change };
}

/** The changes waiting for ops in the places reached, oldest first, as Tasks counts them: none of an erased client's. */
export async function changesAwaitingOps(
  db: D1Database,
  reached: PlacesReached,
): Promise<(NumberChange & { oldMobileE164: string })[]> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.person_id, r.new_mobile_e164, r.state, r.old_verified_at, r.new_verified_at, r.created_at, r.session_id,
         p.mobile_e164 AS old_mobile_e164
       FROM number_change_requests r JOIN people p ON p.id = r.person_id
       WHERE r.state = 'awaiting_ops' AND p.erased_at IS NULL AND ${withinReach("number_change", "r", "?1")}
       ORDER BY r.created_at`,
    )
    .bind(reachBinding(reached))
    .all<Row & { old_mobile_e164: string }>();
  return rows.results.map((row) => ({ ...changeOf(row), oldMobileE164: row.old_mobile_e164 }));
}

type Decision = "confirm" | "reject";

/**
 * Ops' decision. Confirming moves the person to the new number, unless
 * another client already holds it, and keeps the number it replaced, which the
 * referral fraud rules compare (src/domain/referral-grants.ts). It signs out
 * every session of theirs but the one that asked, so a phone that went with the
 * old number is signed in no longer. Only a change waiting for ops can be
 * decided. The caller sends a confirmed number on to the client's Books
 * customer and the CRM lead.
 *
 * A record that holds the new number but never became a client, with a try-on or a waitlist entry and nothing
 * booked, gives the number up, since the client has proved it is now theirs. That record keeps what it holds, has no
 * number, is signed out, and is sent nothing more.
 */
export async function decideNumberChange(
  db: D1Database,
  options: { id: string; decision: Decision; staff: string; reason: string | null; audit: AuditEntry; now: Date },
): Promise<{ readonly personId: string } | "not_waiting" | "number_in_use"> {
  const change = await findNumberChange(db, options.id);
  if (change?.state !== "awaiting_ops") return "not_waiting";

  const at = options.now.toISOString();
  const decide = db
    .prepare(
      `UPDATE number_change_requests SET state = ?2, decided_at = ?3, decided_by = ?4, reason = ?5
       WHERE id = ?1 AND state = 'awaiting_ops'`,
    )
    .bind(change.id, options.decision === "confirm" ? "confirmed" : "rejected", at, options.staff, options.reason);
  // The decision's audit entry goes in the same batch as the decision (src/domain/audit.ts).
  const audit = auditStatement(db, options.audit, options.now);
  const decided = { personId: change.personId };
  if (options.decision === "reject") {
    await db.batch([decide, audit]);
    return decided;
  }

  const holder = await db
    .prepare(
      `SELECT id, (client_since IS NULL AND NOT EXISTS (
         SELECT 1 FROM slot_holds h WHERE h.person_id = people.id AND h.state = 'held')) AS never_a_client
       FROM people WHERE mobile_e164 = ?1 AND id != ?2`,
    )
    .bind(change.newMobileE164, change.personId)
    .first<{ id: string; never_a_client: number }>();
  if (holder !== null && holder.never_a_client !== 1) return "number_in_use";
  const client = { kind: "client", id: change.personId } as const;
  const released = holder === null ? [] : releaseNumber(db, holder.id, options.now);
  const decision = holder === null ? audit : auditStatement(db, releasedIn(options.audit, holder.id), options.now);
  try {
    await db.batch([
      ...released,
      decide,
      // Read before the next statement moves the person off it.
      db
        .prepare(
          "UPDATE number_change_requests SET replaced_mobile_e164 = (SELECT mobile_e164 FROM people WHERE id = ?2) WHERE id = ?1",
        )
        .bind(change.id, change.personId),
      db.prepare("UPDATE people SET mobile_e164 = ?2 WHERE id = ?1").bind(change.personId, change.newMobileE164),
      revokeOthersStatement(db, client, change.sessionId, options.now),
      decision,
    ]);
  } catch (error) {
    // Someone took the number between the check and the batch: the batch wrote nothing.
    if (failedUniqueOn(error, "people")) return "number_in_use";
    throw error;
  }
  return decided;
}

/**
 * The number taken from a record that never became a client, in the batch that gives it to the client: written over
 * with a mark of its own, which no message is sent to, and the record signed out. Written only while it is still no
 * client's, so a record that became one meanwhile keeps its number, and the client's change fails as in use.
 */
function releaseNumber(db: D1Database, personId: string, now: Date): D1PreparedStatement[] {
  return [
    db
      .prepare("UPDATE people SET mobile_e164 = 'released:' || id WHERE id = ?1 AND client_since IS NULL")
      .bind(personId),
    revokeOthersStatement(db, { kind: "client", id: personId }, null, now),
  ];
}

/** The decision's audit entry, naming the record that gave its number up. */
const releasedIn = (entry: AuditEntry, personId: string): AuditEntry => ({
  ...entry,
  detail: { ...entry.detail, released_from: personId },
});
