// A partner's friend, fitted (docs/decisions/0123-partner-referral-channels.md). Once the friend's first fit closes as
// done, and is paid where a consultation and fit in one visit must be, the friend gets the partner's service visits
// and the partner earns its commission, each at the terms in force then, kept with the attribution. No fraud rule
// runs: a partner has no address or payment of ours to compare a friend's with. A first fit refunded under the
// guarantee takes the visits back, and the commission with them.

import { inviteLapsed } from "../../policy/invites.ts";
import { creditExpiry } from "../../policy/referral-reward.ts";
import { clawBack, grantCreditsIf } from "../money/credits.ts";
import { FIRST_FIT_COUNTS } from "./referral-grants.ts";

/** How many partners' friends one pass settles. */
const PER_PASS = 10;

const PENDING = `SELECT r.id, r.referred_person_id, r.via, pin.launched_at, a.id AS first_fit_id,
    c.friend_visits, c.valid_days, c.commission
  FROM channel_attributions r
  JOIN referral_channels c ON c.id = r.channel_id
  JOIN people fp ON fp.id = r.referred_person_id
  CROSS JOIN appointments a ON a.person_id = r.referred_person_id AND a.type = 'first_fit' AND a.status = 'completed'
    AND a.deleted_at IS NULL
  JOIN visit_outcomes v ON v.appointment_id = a.id AND v.outcome = 'done'
  LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode
  WHERE r.grant_state = 'pending' AND fp.erased_at IS NULL AND ${FIRST_FIT_COUNTS}
  ORDER BY a.window_start LIMIT ?1`;

interface Pending {
  readonly id: string;
  readonly referred_person_id: string;
  readonly via: "consultation" | "waitlist";
  readonly launched_at: string | null;
  readonly first_fit_id: string;
  readonly friend_visits: number;
  readonly valid_days: number;
  readonly commission: number;
}

/** True only after the statement that granted attribution ?1 at ?2, in the same batch. */
const GRANTED_HERE = `EXISTS (SELECT 1 FROM channel_attributions WHERE id = ?1 AND grant_state = 'granted' AND updated_at = ?2)`;

/** The grant, and with it the friend's visits and the message that they are theirs: written once, by one pass. */
function grantStatements(db: D1Database, row: Pending, now: Date) {
  const at = now.toISOString();
  const messageId = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `UPDATE channel_attributions SET grant_state = 'granted', first_fit_appointment_id = ?2, friend_visits = ?3,
           valid_days = ?4, commission = ?5, granted_at = ?6, updated_at = ?6
         WHERE id = ?1 AND grant_state = 'pending'`,
      )
      .bind(row.id, row.first_fit_id, row.friend_visits, row.valid_days, row.commission, at),
  ];
  if (row.friend_visits === 0) return { statements, messageId: null };
  statements.push(
    grantCreditsIf(
      db,
      {
        personId: row.referred_person_id,
        visits: row.friend_visits,
        source: "referral",
        sourceId: row.id,
        now,
        expiresAt: creditExpiry(now, row.valid_days),
      },
      { sql: GRANTED_HERE, values: [row.id, at] },
    ),
    db
      .prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
         SELECT ?3, ?2, ?4, 'friend_credited', 'referral', ?1, 'queued', ?2 WHERE ${GRANTED_HERE}`,
      )
      .bind(row.id, at, messageId, row.referred_person_id),
  );
  return { statements, messageId };
}

/**
 * Settles the partners' friends whose first fit has closed as done: one held on a waitlist past the invite's life
 * expires, and the rest are granted. Returns the messages to queue.
 */
export async function settlePartnerReferrals(
  db: D1Database,
  now: Date,
): Promise<{ granted: number; expired: number; messageIds: string[] }> {
  const { results } = await db.prepare(PENDING).bind(PER_PASS).all<Pending>();
  const outcome = { granted: 0, expired: 0, messageIds: [] as string[] };
  const at = now.toISOString();
  const settled = new Set<string>();
  for (const row of results) {
    // A friend with two first fits done comes once for each; the earliest settles it.
    if (settled.has(row.id)) continue;
    settled.add(row.id);
    if (row.via === "waitlist" && row.launched_at !== null && inviteLapsed(new Date(row.launched_at), now)) {
      await db
        .prepare(
          "UPDATE channel_attributions SET grant_state = 'expired', updated_at = ?2 WHERE id = ?1 AND grant_state = 'pending'",
        )
        .bind(row.id, at)
        .run();
      outcome.expired += 1;
      continue;
    }
    const { statements, messageId } = grantStatements(db, row, now);
    const [granted] = await db.batch(statements);
    // Another pass settled it first, and its message is that pass's to send.
    if (granted?.meta.changes !== 1) continue;
    outcome.granted += 1;
    if (messageId !== null) outcome.messageIds.push(messageId);
  }
  return outcome;
}

/** Partners' friends whose first fit has since been refunded in full, under the guarantee: the visits and commission go. */
export async function clawBackPartnerRefunded(db: D1Database, now: Date): Promise<number> {
  const { results } = await db
    .prepare(
      // From the refunded payments, which are few, to the friend each belongs to; never along every friend fitted.
      `SELECT r.id FROM payments p
       CROSS JOIN channel_attributions r ON r.first_fit_appointment_id = p.appointment_id
       WHERE p.kind = 'visit' AND p.status = 'refunded' AND r.grant_state = 'granted' LIMIT ?1`,
    )
    .bind(PER_PASS)
    .all<{ id: string }>();
  for (const { id } of results) {
    await clawBack(db, "referral", id, now);
    await db
      .prepare(
        "UPDATE channel_attributions SET grant_state = 'clawed_back', clawed_back_at = ?2, updated_at = ?2 WHERE id = ?1",
      )
      .bind(id, now.toISOString())
      .run();
  }
  return results.length;
}
