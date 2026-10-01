// The referral grant (docs/decisions/0048-referrals.md, "The grant"). When a referred person's first fit closes
// as done, the fraud rules run first. Then either both sides get their service-visit credits, the referrer a
// WhatsApp that their friend was fitted and the friend one that the credits are theirs, or the grant is held for
// ops' review; a grant ops reject is told to both (docs/decisions/0074-hand-offs-and-messages.md). A referrer who
// has since been erased gets nothing; their friend keeps what the invite promised (ADR 0025, item 24).
//
// A consultation and fit in one visit is paid for after it, by a link (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md),
// so its grant waits until a payment for it is in, by its link or one ops made by hand: until then nothing was sold,
// and the fraud rules, which compare the two people's payments, have none of the friend's to compare (ADR 0025,
// item 93).

import { fullDate } from "@maneman/web-kit/dates";
import { indiaDate } from "../lib/india-time.ts";
import { FRAUD_SIGNALS, REFERRAL_MONTHLY_CAP, type FraudSignal } from "../policy/fraud-holds.ts";
import { inviteLapsed } from "../policy/invites.ts";
import { CREDITS_PER_REFERRAL } from "../policy/referral-reward.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { clawBack, grantCredits } from "./credits.ts";
import { consentGiven, type MessageKind } from "./messages.ts";
import { NO_VISITS_CONSENT } from "./visit-messages.ts";
import { firstNameOf } from "../lib/names.ts";

/** "Karan Bhatia" → "Karan": all the messages and the tracker name a person by. */

export interface Attribution {
  readonly id: string;
  readonly code: string;
  readonly referrerId: string;
  readonly referrerErased: boolean;
  readonly referredId: string;
  /** Kept with the referral when it is granted, for the referrer's tracker; null once the friend is erased. */
  readonly friendFirstName: string | null;
  readonly firstFitId: string;
  readonly firstFitStart: string;
}

/** Which of the fraud rules a grant meets. */
export async function fraudSignals(db: D1Database, attribution: Attribution): Promise<FraudSignal[]> {
  const { referrerId, referredId } = attribution;
  const met = new Set<FraudSignal>();
  const sharedAddress = await db
    .prepare(
      `SELECT 1 FROM addresses a JOIN addresses b
         ON lower(trim(a.line1)) = lower(trim(b.line1)) AND a.pincode = b.pincode
       WHERE a.person_id = ?1 AND b.person_id = ?2 LIMIT 1`,
    )
    .bind(referrerId, referredId)
    .first();
  if (sharedAddress !== null) met.add("shared_address");
  const sharedUpi = await db
    .prepare(
      `SELECT 1 FROM payments a JOIN payments b ON a.vpa_hash = b.vpa_hash
       WHERE a.person_id = ?1 AND b.person_id = ?2 AND a.vpa_hash IS NOT NULL LIMIT 1`,
    )
    .bind(referrerId, referredId)
    .first();
  if (sharedUpi !== null) met.add("shared_upi");
  // The month in India of this fit; the fits already granted or held for the referrer in it.
  const month = indiaDate(new Date(attribution.firstFitStart)).slice(0, 7);
  const { results } = await db
    .prepare(
      `SELECT a.window_start FROM referral_attributions r JOIN appointments a ON a.id = r.first_fit_appointment_id
       WHERE r.code = ?1 AND r.id != ?2 AND r.grant_state IN ('held', 'approved', 'granted')`,
    )
    .bind(attribution.code, attribution.id)
    .all<{ window_start: string }>();
  const thisMonth = results.filter((fit) => indiaDate(new Date(fit.window_start)).slice(0, 7) === month).length;
  if (thisMonth >= REFERRAL_MONTHLY_CAP) met.add("monthly_cap");
  // A number belongs to one person at a time, and nobody is attributed to their own invite
  // (src/domain/referrals.ts), so the two can only share a number through a change of number:
  // one of them holds, or once held, a number the other holds or once held.
  const referrerNumbers = await numbersHeld(db, referrerId);
  const friendNumbers = await numbersHeld(db, referredId);
  if (referrerNumbers.some((number) => friendNumbers.includes(number))) met.add("same_mobile");
  return FRAUD_SIGNALS.filter((signal) => met.has(signal));
}

/**
 * Every number a person holds or has held: their own now, and each a change ops
 * confirmed moved them to or from. A change withdrawn or rejected never happened.
 */
async function numbersHeld(db: D1Database, personId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT mobile_e164 AS mobile FROM people WHERE id = ?1
       UNION SELECT new_mobile_e164 FROM number_change_requests WHERE person_id = ?1 AND state = 'confirmed'
       UNION SELECT replaced_mobile_e164 FROM number_change_requests
         WHERE person_id = ?1 AND state = 'confirmed' AND replaced_mobile_e164 IS NOT NULL`,
    )
    .bind(personId)
    .all<{ mobile: string }>();
  return results.map((row) => row.mobile);
}

type ReferralMessageKind = Extract<MessageKind, "friend_fitted" | "friend_credited" | "referral_rejected">;

/** A message to one side of a referral, about it; for the batch that decides the grant. */
function referralMessage(
  db: D1Database,
  input: { personId: string; kind: ReferralMessageKind; attributionId: string; now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       VALUES (?1, ?2, ?3, ?4, 'referral', ?5, 'queued', ?2)`,
    )
    .bind(id, input.now.toISOString(), input.personId, input.kind, input.attributionId);
  return { id, statement };
}

/**
 * The credits both sides get, and the message to each; the attribution's new state goes with them. The friend is
 * told their credits have landed, as the referrer is told of the fit (LIFE-10).
 */
export function grantStatements(
  db: D1Database,
  attribution: Attribution,
  state: "granted" | "approved",
  now: Date,
  review: { staff: string; reason: string | null } | null = null,
): { statements: D1PreparedStatement[]; messageIds: string[] } {
  const grant = (personId: string) =>
    grantCredits(db, {
      personId,
      visits: CREDITS_PER_REFERRAL,
      source: "referral",
      sourceId: attribution.id,
      now,
    });
  const at = now.toISOString();
  const statements = [
    grant(attribution.referredId),
    db
      .prepare(
        `UPDATE referral_attributions SET grant_state = ?2, first_fit_appointment_id = ?3, updated_at = ?4,
           reviewed_by = COALESCE(?5, reviewed_by), review_reason = COALESCE(?6, review_reason),
           reviewed_at = CASE WHEN ?5 IS NULL THEN reviewed_at ELSE ?4 END,
           friend_first_name = COALESCE(?7, friend_first_name)
         WHERE id = ?1`,
      )
      .bind(
        attribution.id,
        state,
        attribution.firstFitId,
        at,
        review?.staff ?? null,
        review?.reason ?? null,
        attribution.friendFirstName,
      ),
  ];
  const toFriend = referralMessage(db, {
    personId: attribution.referredId,
    kind: "friend_credited",
    attributionId: attribution.id,
    now,
  });
  statements.push(toFriend.statement);
  if (attribution.referrerErased) return { statements, messageIds: [toFriend.id] };
  const toReferrer = referralMessage(db, {
    personId: attribution.referrerId,
    kind: "friend_fitted",
    attributionId: attribution.id,
    now,
  });
  statements.push(grant(attribution.referrerId), toReferrer.statement);
  return { statements, messageIds: [toFriend.id, toReferrer.id] };
}

// CROSS JOIN keeps the referrals as the outer loop. Left to itself, SQLite walks every visit ever made to
// save sorting the few pending referrals, and the five-minute cron would read them all on each run.
const ATTRIBUTION = `SELECT r.id, r.code, rc.person_id AS referrer_id, rp.erased_at AS referrer_erased,
    r.referred_person_id, fp.name AS friend_name, fp.erased_at AS friend_erased, a.id AS first_fit_id,
    a.window_start, r.via, pin.launched_at
  FROM referral_attributions r
  JOIN referral_codes rc ON rc.code = r.code JOIN people rp ON rp.id = rc.person_id
  JOIN people fp ON fp.id = r.referred_person_id
  CROSS JOIN appointments a ON a.person_id = r.referred_person_id AND a.type = 'first_fit' AND a.status = 'completed'
    AND a.deleted_at IS NULL
    AND (a.one_visit IS NULL OR EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.kind = 'visit'
      AND p.status IN ('captured', 'partially_refunded')))
  JOIN visits v ON v.appointment_id = a.id AND v.outcome = 'done'
  LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode`;

interface AttributionRow {
  id: string;
  code: string;
  referrer_id: string;
  referrer_erased: string | null;
  referred_person_id: string;
  friend_name: string;
  friend_erased: string | null;
  first_fit_id: string;
  window_start: string;
  via: "consultation" | "waitlist";
  launched_at: string | null;
}

const attributionFrom = (row: AttributionRow): Attribution => ({
  id: row.id,
  code: row.code,
  referrerId: row.referrer_id,
  referrerErased: row.referrer_erased !== null,
  referredId: row.referred_person_id,
  friendFirstName: row.friend_erased === null ? firstNameOf(row.friend_name) : null,
  firstFitId: row.first_fit_id,
  firstFitStart: row.window_start,
});

/** How many pending referrals one pass settles. */
const PER_PASS = 10;

/**
 * Settles the pending referrals whose friend's first fit has closed as done: a lapsed invite expires, a grant
 * meeting a fraud rule is held, and the rest are granted. Returns the messages to queue.
 */
export async function settleReferrals(
  db: D1Database,
  now: Date,
): Promise<{ granted: number; held: number; expired: number; messageIds: string[] }> {
  const { results } = await db
    .prepare(`${ATTRIBUTION} WHERE r.grant_state = 'pending' AND fp.erased_at IS NULL ORDER BY a.window_start LIMIT ?1`)
    .bind(PER_PASS)
    .all<AttributionRow>();
  const outcome = { granted: 0, held: 0, expired: 0, messageIds: [] as string[] };
  const at = now.toISOString();
  const settled = new Set<string>();
  for (const row of results) {
    // A friend with two first fits done comes once for each; the earliest settles the referral.
    if (settled.has(row.id)) continue;
    settled.add(row.id);
    // An invite from a waitlist holds until 12 months after its area launched.
    if (row.via === "waitlist" && row.launched_at !== null && inviteLapsed(new Date(row.launched_at), now)) {
      await db
        .prepare("UPDATE referral_attributions SET grant_state = 'expired', updated_at = ?2 WHERE id = ?1")
        .bind(row.id, at)
        .run();
      outcome.expired += 1;
      continue;
    }
    const attribution = attributionFrom(row);
    const signals = await fraudSignals(db, attribution);
    if (signals.length > 0) {
      await db
        .prepare(
          `UPDATE referral_attributions SET grant_state = 'held', fraud_signals = ?2, first_fit_appointment_id = ?3,
             updated_at = ?4
           WHERE id = ?1`,
        )
        .bind(row.id, JSON.stringify(signals), attribution.firstFitId, at)
        .run();
      outcome.held += 1;
      continue;
    }
    const { statements, messageIds } = grantStatements(db, attribution, "granted", now);
    await db.batch(statements);
    outcome.granted += 1;
    outcome.messageIds.push(...messageIds);
  }
  return outcome;
}

/**
 * Ops' decision on a held grant: approve it, and the credits and both messages follow, or reject it with the
 * reason, and both sides are told they were not given, never why.
 */
export async function decideHeldReferral(
  db: D1Database,
  input: {
    id: string;
    decision: "approve" | "reject";
    staff: string;
    reason: string | null;
    /** Written in the same batch as the decision (src/domain/audit.ts). */
    audit: AuditEntry;
    now: Date;
  },
): Promise<{ state: "approved" | "rejected"; messageIds: string[] } | null> {
  const row = await db
    .prepare(`${ATTRIBUTION} WHERE r.id = ?1 AND r.grant_state = 'held'`)
    .bind(input.id)
    .first<AttributionRow>();
  if (row === null) return null;
  const audit = auditStatement(db, input.audit, input.now);
  if (input.decision === "reject") {
    const attribution = attributionFrom(row);
    const told = [attribution.referredId, ...(attribution.referrerErased ? [] : [attribution.referrerId])].map(
      (personId) =>
        referralMessage(db, { personId, kind: "referral_rejected", attributionId: input.id, now: input.now }),
    );
    await db.batch([
      db
        .prepare(
          `UPDATE referral_attributions SET grant_state = 'rejected', reviewed_by = ?2, review_reason = ?3,
             reviewed_at = ?4, updated_at = ?4
           WHERE id = ?1 AND grant_state = 'held'`,
        )
        .bind(input.id, input.staff, input.reason, input.now.toISOString()),
      ...told.map((message) => message.statement),
      audit,
    ]);
    return { state: "rejected", messageIds: told.map((message) => message.id) };
  }
  const { statements, messageIds } = grantStatements(db, attributionFrom(row), "approved", input.now, {
    staff: input.staff,
    reason: input.reason,
  });
  await db.batch([...statements, audit]);
  return { state: "approved", messageIds };
}

/** Referrals whose friend's first fit has since been refunded in full, under the guarantee: their credits go. */
export async function clawBackRefunded(db: D1Database, now: Date): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT r.id FROM referral_attributions r
       JOIN payments p ON p.appointment_id = r.first_fit_appointment_id AND p.kind = 'visit'
       WHERE r.grant_state IN ('granted', 'approved') AND p.status = 'refunded' LIMIT ?1`,
    )
    .bind(PER_PASS)
    .all<{ id: string }>();
  for (const { id } of results) {
    await clawBack(db, "referral", id, now);
    await db
      .prepare("UPDATE referral_attributions SET grant_state = 'clawed_back', updated_at = ?2 WHERE id = ?1")
      .bind(id, now.toISOString())
      .run();
  }
  return results.length;
}

/** The referrer's message: their friend was fitted, and what they each now have. */
export async function composeFriendFitted(
  db: D1Database,
  attributionId: string,
  referrerId: string,
): Promise<{ template: string; params: string[] } | { skip: string }> {
  const row = await db
    .prepare(
      `SELECT rp.name AS referrer, fp.name AS friend, g.expires_at FROM referral_attributions r
       JOIN referral_codes rc ON rc.code = r.code JOIN people rp ON rp.id = rc.person_id
       JOIN people fp ON fp.id = r.referred_person_id
       LEFT JOIN credit_ledger g ON g.kind = 'grant' AND g.source_kind = 'referral' AND g.source_id = r.id
         AND g.person_id = rc.person_id
       WHERE r.id = ?1 AND rc.person_id = ?2 AND r.grant_state IN ('granted', 'approved')`,
    )
    .bind(attributionId, referrerId)
    .first<{ referrer: string; friend: string; expires_at: string | null }>();
  if (row === null) return { skip: "no grant for the referrer" };
  const expiresAt = row.expires_at;
  if (expiresAt === null) return { skip: "no grant for the referrer" };
  return {
    template: "friend_fitted_v1",
    params: [
      firstNameOf(row.referrer),
      firstNameOf(row.friend),
      String(CREDITS_PER_REFERRAL),
      fullDate(indiaDate(new Date(expiresAt))),
    ],
  };
}

/**
 * The friend's message: the invite's credits are theirs, and until when. It does not name the referrer, whose
 * name the invite itself shows only with their consent (ADR 0048). Sent with the friend's consent to WhatsApp
 * about visits, which the landing's consultation line records; the credits are service visits.
 */
export async function composeFriendCredited(
  db: D1Database,
  attributionId: string,
  friendId: string,
): Promise<{ template: string; params: string[] } | { skip: string }> {
  if (!(await consentGiven(db, friendId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  const row = await db
    .prepare(
      `SELECT fp.name, g.expires_at FROM referral_attributions r JOIN people fp ON fp.id = r.referred_person_id
       JOIN credit_ledger g ON g.kind = 'grant' AND g.source_kind = 'referral' AND g.source_id = r.id
         AND g.person_id = r.referred_person_id AND g.expires_at IS NOT NULL
       WHERE r.id = ?1 AND r.referred_person_id = ?2 AND r.grant_state IN ('granted', 'approved')`,
    )
    .bind(attributionId, friendId)
    .first<{ name: string; expires_at: string }>();
  if (row === null) return { skip: "no grant for the friend" };
  return {
    template: "friend_credited_v1",
    params: [firstNameOf(row.name), String(CREDITS_PER_REFERRAL), fullDate(indiaDate(new Date(row.expires_at)))],
  };
}

/**
 * A rejected grant, told to each side without ops' reason, which stays with the decision. The friend's goes with
 * their consent to WhatsApp about visits. The referrer's, like the message of a fit, needs none of its own: an
 * interim reading of the owner's ruling that the referrer is told (ADR 0025, "The messages people are owed").
 */
export async function composeReferralRejected(
  db: D1Database,
  attributionId: string,
  personId: string,
): Promise<{ template: string; params: string[] } | { skip: string }> {
  const row = await db
    .prepare(
      `SELECT r.referred_person_id AS friend_id, fp.name AS friend, rc.person_id AS referrer_id, rp.name AS referrer
       FROM referral_attributions r JOIN people fp ON fp.id = r.referred_person_id
       JOIN referral_codes rc ON rc.code = r.code JOIN people rp ON rp.id = rc.person_id
       WHERE r.id = ?1 AND r.grant_state = 'rejected'`,
    )
    .bind(attributionId)
    .first<{ friend_id: string; friend: string; referrer_id: string; referrer: string }>();
  if (row === null) return { skip: "the grant was not rejected" };
  if (personId === row.referrer_id) {
    return { template: "referral_rejected_referrer_v1", params: [firstNameOf(row.referrer), firstNameOf(row.friend)] };
  }
  if (personId !== row.friend_id) return { skip: "not a party to the referral" };
  if (!(await consentGiven(db, personId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  return { template: "referral_rejected_friend_v1", params: [firstNameOf(row.friend)] };
}
