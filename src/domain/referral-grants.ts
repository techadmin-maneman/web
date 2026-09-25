// The referral grant (docs/decisions/0048-referrals.md, "The grant"). When a referred person's first fit closes
// as done, the fraud rules run first. Then either both sides get their service-visit credits, and the referrer a
// WhatsApp that their friend was fitted, or the grant is held for ops' review. A referrer who has since been
// erased gets nothing; their friend keeps what the invite promised (ADR 0025, item 24).

import { fullDate } from "@maneman/web-kit/dates";
import { indiaDate } from "../lib/india-time.ts";
import { FRAUD_SIGNALS, REFERRAL_MONTHLY_CAP, type FraudSignal } from "../policy/fraud-holds.ts";
import { inviteLapsed } from "../policy/invites.ts";
import { CREDITS_PER_REFERRAL } from "../policy/referral-reward.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { clawBack, grantCredits } from "./credits.ts";

export interface Attribution {
  readonly id: string;
  readonly code: string;
  readonly referrerId: string;
  readonly referrerErased: boolean;
  readonly referredId: string;
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
  const mobiles = await db
    .prepare(
      "SELECT (SELECT mobile_e164 FROM people WHERE id = ?1) = (SELECT mobile_e164 FROM people WHERE id = ?2) AS same",
    )
    .bind(referrerId, referredId)
    .first<{ same: number | null }>();
  if (mobiles?.same === 1) met.add("same_mobile");
  return FRAUD_SIGNALS.filter((signal) => met.has(signal));
}

/** The credits both sides get, and the referrer's message; the attribution's new state goes with them. */
export function grantStatements(
  db: D1Database,
  attribution: Attribution,
  state: "granted" | "approved",
  now: Date,
  review: { staff: string; reason: string | null } | null = null,
): { statements: D1PreparedStatement[]; messageId: string | null } {
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
           reviewed_at = CASE WHEN ?5 IS NULL THEN reviewed_at ELSE ?4 END
         WHERE id = ?1`,
      )
      .bind(attribution.id, state, attribution.firstFitId, at, review?.staff ?? null, review?.reason ?? null),
  ];
  if (attribution.referrerErased) return { statements, messageId: null };
  const messageId = crypto.randomUUID();
  statements.push(
    grant(attribution.referrerId),
    db
      .prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
         VALUES (?1, ?2, ?3, 'friend_fitted', 'referral', ?4, 'queued', ?2)`,
      )
      .bind(messageId, at, attribution.referrerId, attribution.id),
  );
  return { statements, messageId };
}

// CROSS JOIN keeps the referrals as the outer loop. Left to itself, SQLite walks every visit ever made to
// save sorting the few pending referrals, and the five-minute cron would read them all on each run.
const ATTRIBUTION = `SELECT r.id, r.code, rc.person_id AS referrer_id, rp.erased_at AS referrer_erased,
    r.referred_person_id, a.id AS first_fit_id, a.window_start, r.via, pin.launched_at
  FROM referral_attributions r
  JOIN referral_codes rc ON rc.code = r.code JOIN people rp ON rp.id = rc.person_id
  JOIN people fp ON fp.id = r.referred_person_id
  CROSS JOIN appointments a ON a.person_id = r.referred_person_id AND a.type = 'first_fit' AND a.status = 'completed'
    AND a.deleted_at IS NULL
  JOIN visits v ON v.appointment_id = a.id AND v.outcome = 'done'
  LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode`;

interface AttributionRow {
  id: string;
  code: string;
  referrer_id: string;
  referrer_erased: string | null;
  referred_person_id: string;
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
  for (const row of results) {
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
    const { statements, messageId } = grantStatements(db, attribution, "granted", now);
    await db.batch(statements);
    outcome.granted += 1;
    if (messageId !== null) outcome.messageIds.push(messageId);
  }
  return outcome;
}

/** Ops' decision on a held grant: approve it, and the credits follow, or reject it with the reason. */
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
): Promise<{ state: "approved" | "rejected"; messageId: string | null } | null> {
  const row = await db
    .prepare(`${ATTRIBUTION} WHERE r.id = ?1 AND r.grant_state = 'held'`)
    .bind(input.id)
    .first<AttributionRow>();
  if (row === null) return null;
  const audit = auditStatement(db, input.audit, input.now);
  if (input.decision === "reject") {
    await db.batch([
      db
        .prepare(
          `UPDATE referral_attributions SET grant_state = 'rejected', reviewed_by = ?2, review_reason = ?3,
             reviewed_at = ?4, updated_at = ?4
           WHERE id = ?1 AND grant_state = 'held'`,
        )
        .bind(input.id, input.staff, input.reason, input.now.toISOString()),
      audit,
    ]);
    return { state: "rejected", messageId: null };
  }
  const { statements, messageId } = grantStatements(db, attributionFrom(row), "approved", input.now, {
    staff: input.staff,
    reason: input.reason,
  });
  await db.batch([...statements, audit]);
  return { state: "approved", messageId };
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
  const first = (name: string) => name.split(" ")[0] ?? name;
  return {
    template: "friend_fitted_v1",
    params: [
      first(row.referrer),
      first(row.friend),
      String(CREDITS_PER_REFERRAL),
      fullDate(indiaDate(new Date(expiresAt))),
    ],
  };
}
