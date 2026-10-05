// The referral grant (docs/decisions/0048-referrals.md, "The grant"). When a referred person's first fit closes
// as done, the fraud rules run first. Then either each side gets the service-visit credits ops set for it, the
// referrer a WhatsApp that their friend was fitted and the friend one that the credits are theirs, or the grant is
// held for ops' review; a grant ops reject is told to each side it would have given visits
// (docs/decisions/0074-hand-offs-and-messages.md). A referrer who has since been erased gets nothing; their friend
// keeps what the invite promised (ADR 0025, item 24).
//
// What each side gets, and how long it lasts, is the reward in force when the friend's first fit settles the
// referral, kept with it, so a grant held for review is given that reward when ops approve it
// (docs/decisions/0107-referral-rewards-in-the-console.md). Credits already given keep their visits and their date.
//
// A consultation and fit in one visit is paid for after it, by a link (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md),
// so its grant waits until a payment for it is in, by its link or one ops made by hand: until then nothing was sold,
// and the fraud rules, which compare the two people's payments, have none of the friend's to compare (ADR 0025,
// item 93). One a discount code left nothing to pay is settled by the fit itself, as the owner ruled on 1 October
// 2026, "Yes, once fitted" (docs/decisions/0108-discount-codes.md).

import { indiaDate } from "../lib/india-time.ts";
import { FRAUD_SIGNALS, REFERRAL_MONTHLY_CAP, type FraudSignal } from "../policy/fraud-holds.ts";
import { inviteLapsed } from "../policy/invites.ts";
import { creditExpiry, type ReferralReward } from "../policy/referral-reward.ts";
import { auditStatementIfStamped, type AuditEntry } from "./audit.ts";
import { clawBack } from "./credits.ts";
import type { MessageKind } from "../config/message-kinds.ts";
import { firstNameOf } from "../lib/names.ts";
import { PAYMENT_HELD, statusIn } from "../config/statuses.ts";

/** "Karan Bhatia" → "Karan": all the messages and the tracker name a person by. */

interface ReferralAttribution {
  readonly id: string;
  readonly code: string;
  readonly referrerId: string;
  readonly referrerErased: boolean;
  readonly referredId: string;
  /** Kept with the referral when it is granted, for the referrer's tracker; null once the friend is erased. */
  readonly friendFirstName: string | null;
  readonly firstFitId: string;
  readonly firstFitStart: string;
  /** The reward it was settled under, kept when it was held; null for one held before rewards were kept. */
  readonly keptReward: ReferralReward | null;
}

/** Which of the fraud rules a grant meets. */
async function fraudSignals(db: D1Database, attribution: ReferralAttribution): Promise<FraudSignal[]> {
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

/**
 * A grant as one batch settled it: the state it wrote, and when. What the batch writes beside the state, the credits,
 * the messages and the audit entry, checks for it, so a grant decided twice at once, an approve racing a reject or two
 * passes of the cron, writes them once, for the decision that stood.
 */
interface Settled {
  readonly state: "granted" | "approved" | "rejected";
  readonly at: string;
}

/** True only after the statement that wrote referral ?1 to state ?2 at ?3, in the same batch. */
const SETTLED_HERE = `EXISTS (SELECT 1 FROM referral_attributions WHERE id = ?1 AND grant_state = ?2 AND updated_at = ?3)`;

/** A message to one side of a referral, about it, written only by the batch that settled the grant. */
function referralMessage(
  db: D1Database,
  input: { personId: string; kind: ReferralMessageKind; attributionId: string; now: Date },
  settled: Settled,
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       SELECT ?4, ?5, ?6, ?7, 'referral', ?1, 'queued', ?5 WHERE ${SETTLED_HERE}`,
    )
    .bind(input.attributionId, settled.state, settled.at, id, input.now.toISOString(), input.personId, input.kind);
  return { id, statement };
}

/** A side's credits under the grant, written only by the batch that settled it, and once, as every grant is. */
function referralCredits(
  db: D1Database,
  input: { personId: string; visits: number; attributionId: string; expiresAt: Date; now: Date },
  settled: Settled,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
       SELECT ?4, ?5, 'grant', ?6, 'referral', ?1, ?7, ?8 WHERE ${SETTLED_HERE}
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      input.attributionId,
      settled.state,
      settled.at,
      crypto.randomUUID(),
      input.personId,
      input.visits,
      input.expiresAt.toISOString(),
      input.now.toISOString(),
    );
}

/**
 * The credits each side gets under `reward`, and the message to each; the attribution's new state, and the reward it
 * was given under, go with them. The friend is told their credits have landed, as the referrer is told of the fit
 * (LIFE-10). A side the reward gives nothing gets no credits; the friend is then told nothing, and the referrer is
 * still told of the fit.
 */
function grantStatements(
  db: D1Database,
  attribution: ReferralAttribution,
  reward: ReferralReward,
  state: "granted" | "approved",
  now: Date,
  review: { staff: string; reason: string | null } | null = null,
): { statements: D1PreparedStatement[]; messageIds: string[] } {
  const expiresAt = creditExpiry(now, reward.valid_days);
  const at = now.toISOString();
  const settled: Settled = { state, at };
  const grant = (personId: string, visits: number) =>
    referralCredits(db, { personId, visits, attributionId: attribution.id, expiresAt, now }, settled);
  const statements = [
    db
      .prepare(
        `UPDATE referral_attributions SET grant_state = ?2, first_fit_appointment_id = ?3, updated_at = ?4,
           reviewed_by = COALESCE(?5, reviewed_by), review_reason = COALESCE(?6, review_reason),
           reviewed_at = CASE WHEN ?5 IS NULL THEN reviewed_at ELSE ?4 END,
           friend_first_name = COALESCE(?7, friend_first_name),
           referrer_visits = ?8, friend_visits = ?9, credit_valid_days = ?10
         WHERE id = ?1 AND grant_state = ?11`,
      )
      .bind(
        attribution.id,
        state,
        attribution.firstFitId,
        at,
        review?.staff ?? null,
        review?.reason ?? null,
        attribution.friendFirstName,
        reward.referrer_visits,
        reward.friend_visits,
        reward.valid_days,
        // The cron settles a grant from pending, and ops from held; nothing settles it from any other state.
        state === "granted" ? "pending" : "held",
      ),
  ];
  const messageIds: string[] = [];
  if (reward.friend_visits > 0) {
    const toFriend = referralMessage(
      db,
      { personId: attribution.referredId, kind: "friend_credited", attributionId: attribution.id, now },
      settled,
    );
    statements.push(grant(attribution.referredId, reward.friend_visits), toFriend.statement);
    messageIds.push(toFriend.id);
  }
  if (attribution.referrerErased) return { statements, messageIds };
  const toReferrer = referralMessage(
    db,
    { personId: attribution.referrerId, kind: "friend_fitted", attributionId: attribution.id, now },
    settled,
  );
  if (reward.referrer_visits > 0) statements.push(grant(attribution.referrerId, reward.referrer_visits));
  statements.push(toReferrer.statement);
  messageIds.push(toReferrer.id);
  return { statements, messageIds };
}

/** A first fit that counts: any but a one visit, and a one visit once it is paid or owes nothing. */
const PAID = `(a.one_visit IS NULL OR a.nothing_owed_at IS NOT NULL OR EXISTS (SELECT 1 FROM payments p
      WHERE p.appointment_id = a.id AND p.kind = 'visit' AND ${statusIn("p.status", PAYMENT_HELD)}))`;

// Each referral with its friend's first fit done.
// CROSS JOIN keeps the referrals as the outer loop. Left to itself, SQLite walks every visit ever made to
// save sorting the few pending referrals, and the five-minute cron would read them all on each run.
const ATTRIBUTION = `SELECT r.id, r.code, rc.person_id AS referrer_id, rp.erased_at AS referrer_erased,
    r.referred_person_id, fp.name AS friend_name, fp.erased_at AS friend_erased, a.id AS first_fit_id,
    a.window_start, r.via, pin.launched_at, r.referrer_visits, r.friend_visits, r.credit_valid_days, ${PAID} AS paid
  FROM referral_attributions r
  JOIN referral_codes rc ON rc.code = r.code JOIN people rp ON rp.id = rc.person_id
  JOIN people fp ON fp.id = r.referred_person_id
  CROSS JOIN appointments a ON a.person_id = r.referred_person_id AND a.type = 'first_fit' AND a.status = 'completed'
    AND a.deleted_at IS NULL`;

const FIT_DONE = `JOIN visits v ON v.appointment_id = a.id AND v.outcome = 'done'
  LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode`;

/** The pending referrals one pass settles, the earliest first fit that counts first. */
const PENDING_SETTLEMENTS = `${ATTRIBUTION} AND ${PAID} ${FIT_DONE}
  WHERE r.grant_state = 'pending' AND fp.erased_at IS NULL ORDER BY a.window_start LIMIT ?1`;

/**
 * One held referral, for ops to approve or reject: found whether its one visit is paid or not, so a grant held for a
 * consultation and fit never paid can still be rejected, and is approved only once it is.
 */
const HELD_FOR_REVIEW = `${ATTRIBUTION} ${FIT_DONE} WHERE r.id = ?1 AND r.grant_state = 'held'`;

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
  referrer_visits: number | null;
  friend_visits: number | null;
  credit_valid_days: number | null;
  /** 1 once the first fit counts (PAID). */
  paid: number;
}

/** The reward a referral was held under, or null where it was held before rewards were kept. */
function keptRewardOf(row: AttributionRow): ReferralReward | null {
  if (row.referrer_visits === null || row.friend_visits === null || row.credit_valid_days === null) return null;
  return { referrer_visits: row.referrer_visits, friend_visits: row.friend_visits, valid_days: row.credit_valid_days };
}

const attributionFrom = (row: AttributionRow): ReferralAttribution => ({
  id: row.id,
  code: row.code,
  referrerId: row.referrer_id,
  referrerErased: row.referrer_erased !== null,
  referredId: row.referred_person_id,
  friendFirstName: row.friend_erased === null ? firstNameOf(row.friend_name) : null,
  firstFitId: row.first_fit_id,
  firstFitStart: row.window_start,
  keptReward: keptRewardOf(row),
});

/** How many pending referrals one pass settles. */
const PER_PASS = 10;

/**
 * Settles the pending referrals whose friend's first fit has closed as done: a lapsed invite expires, a grant
 * meeting a fraud rule is held, keeping `reward`, the one in force, and the rest are granted under it. Returns the
 * messages to queue.
 */
export async function settleReferrals(
  db: D1Database,
  now: Date,
  reward: ReferralReward,
): Promise<{ granted: number; held: number; expired: number; messageIds: string[] }> {
  const { results } = await db.prepare(PENDING_SETTLEMENTS).bind(PER_PASS).all<AttributionRow>();
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
        .prepare(
          "UPDATE referral_attributions SET grant_state = 'expired', updated_at = ?2 WHERE id = ?1 AND grant_state = 'pending'",
        )
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
             updated_at = ?4, referrer_visits = ?5, friend_visits = ?6, credit_valid_days = ?7
           WHERE id = ?1 AND grant_state = 'pending'`,
        )
        .bind(
          row.id,
          JSON.stringify(signals),
          attribution.firstFitId,
          at,
          reward.referrer_visits,
          reward.friend_visits,
          reward.valid_days,
        )
        .run();
      outcome.held += 1;
      continue;
    }
    const { statements, messageIds } = grantStatements(db, attribution, reward, "granted", now);
    const [granted] = await db.batch(statements);
    // Another pass settled it first, and its messages are that pass's to send.
    if (granted?.meta.changes !== 1) continue;
    outcome.granted += 1;
    outcome.messageIds.push(...messageIds);
  }
  return outcome;
}

/** The sides a rejected grant is told of: each the reward would have given visits, and never an erased referrer. */
function toldOfRejection(attribution: ReferralAttribution, reward: ReferralReward): string[] {
  const told: string[] = [];
  if (reward.friend_visits > 0) told.push(attribution.referredId);
  if (reward.referrer_visits > 0 && !attribution.referrerErased) told.push(attribution.referrerId);
  return told;
}

/**
 * Ops' decision on a held grant: approve it, and the credits and both messages follow, or reject it with the
 * reason, and each side it would have given visits is told they were not given, never why. Either way the reward
 * is the one it was held under; `rewardNow`, the one in force, stands in for a grant held before rewards were kept.
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
    rewardNow: ReferralReward;
    now: Date;
  },
): Promise<{ state: "approved" | "rejected"; messageIds: string[] } | "not_paid" | null> {
  const row = await db.prepare(HELD_FOR_REVIEW).bind(input.id).first<AttributionRow>();
  if (row === null) return null;
  if (input.decision === "approve" && row.paid !== 1) return "not_paid";
  const attribution = attributionFrom(row);
  const reward = attribution.keptReward ?? input.rewardNow;
  const audit = auditStatementIfStamped(db, input.audit, input.now, {
    table: "referral_attributions",
    column: "updated_at",
    id: input.id,
  });
  if (input.decision === "reject") {
    const rejected: Settled = { state: "rejected", at: input.now.toISOString() };
    const told = toldOfRejection(attribution, reward).map((personId) =>
      referralMessage(db, { personId, kind: "referral_rejected", attributionId: input.id, now: input.now }, rejected),
    );
    const [decided] = await db.batch([
      db
        .prepare(
          `UPDATE referral_attributions SET grant_state = 'rejected', reviewed_by = ?2, review_reason = ?3,
             reviewed_at = ?4, updated_at = ?4
           WHERE id = ?1 AND grant_state = 'held'`,
        )
        .bind(input.id, input.staff, input.reason, rejected.at),
      ...told.map((message) => message.statement),
      audit,
    ]);
    // Decided by another member of staff between the read and the batch: theirs stands, and this wrote nothing.
    if (decided?.meta.changes !== 1) return null;
    return { state: "rejected", messageIds: told.map((message) => message.id) };
  }
  const { statements, messageIds } = grantStatements(db, attribution, reward, "approved", input.now, {
    staff: input.staff,
    reason: input.reason,
  });
  const [decided] = await db.batch([...statements, audit]);
  if (decided?.meta.changes !== 1) return null;
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
