// The messages a referral's grant sends (docs/decisions/0048-referrals.md): the referrer told their friend was fitted,
// the friend told their credits have landed, and either told a held grant was rejected. Composed when each is sent,
// from the grant as the ledger holds it (src/domain/referrals/referral-grants.ts writes them).

import { fullDate } from "@maneman/web-kit/dates";
import { serviceVisits, type TemplateName } from "../../config/message-templates.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { firstNameOf } from "../../lib/names.ts";
import { consentGiven } from "../privacy/consents.ts";
import { NO_VISITS_CONSENT, type Composed } from "../messages/visit-messages.ts";

/** The referrer's text, by what each side was given: the same, different, nothing to the friend. */
function friendFittedTemplate(referrerVisits: number, friendVisits: number): TemplateName {
  if (friendVisits === 0) return "friend_fitted_yours_v1";
  if (friendVisits === referrerVisits) return "friend_fitted_v2";
  return "friend_fitted_each_v1";
}

/**
 * The referrer's message: their friend was fitted, and what they each now have, as the ledger holds what each was
 * given. A referrer given nothing is thanked for the introduction.
 */
export async function composeFriendFitted(
  db: D1Database,
  attributionId: string,
  referrerId: string,
): Promise<Composed> {
  const row = await db
    .prepare(
      `SELECT rp.name AS referrer, fp.name AS friend, mine.visits AS referrer_visits, mine.expires_at,
         theirs.visits AS friend_visits
       FROM referral_attributions r
       JOIN referral_codes rc ON rc.code = r.code JOIN people rp ON rp.id = rc.person_id
       JOIN people fp ON fp.id = r.referred_person_id
       LEFT JOIN credit_ledger mine ON mine.kind = 'grant' AND mine.source_kind = 'referral' AND mine.source_id = r.id
         AND mine.person_id = rc.person_id
       LEFT JOIN credit_ledger theirs ON theirs.kind = 'grant' AND theirs.source_kind = 'referral'
         AND theirs.source_id = r.id AND theirs.person_id = r.referred_person_id
       WHERE r.id = ?1 AND rc.person_id = ?2 AND r.grant_state IN ('granted', 'approved')`,
    )
    .bind(attributionId, referrerId)
    .first<{
      referrer: string;
      friend: string;
      referrer_visits: number | null;
      expires_at: string | null;
      friend_visits: number | null;
    }>();
  if (row === null) return { skip: "no grant for the referrer" };
  const names = [firstNameOf(row.referrer), firstNameOf(row.friend)];
  if (row.referrer_visits === null || row.expires_at === null) {
    return { template: "friend_fitted_thanks_v1", params: names };
  }
  const friendVisits = row.friend_visits ?? 0;
  return {
    template: friendFittedTemplate(row.referrer_visits, friendVisits),
    params: [
      ...names,
      serviceVisits(row.referrer_visits),
      fullDate(indiaDate(new Date(row.expires_at))),
      serviceVisits(friendVisits),
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
): Promise<Composed> {
  if (!(await consentGiven(db, friendId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  const row = await db
    .prepare(
      `SELECT fp.name, g.visits, g.expires_at FROM referral_attributions r
       JOIN people fp ON fp.id = r.referred_person_id
       JOIN credit_ledger g ON g.kind = 'grant' AND g.source_kind = 'referral' AND g.source_id = r.id
         AND g.person_id = r.referred_person_id AND g.expires_at IS NOT NULL
       WHERE r.id = ?1 AND r.referred_person_id = ?2 AND r.grant_state IN ('granted', 'approved')`,
    )
    .bind(attributionId, friendId)
    .first<{ name: string; visits: number; expires_at: string }>();
  if (row === null) return { skip: "no grant for the friend" };
  return {
    template: "friend_credited_v2",
    params: [firstNameOf(row.name), serviceVisits(row.visits), fullDate(indiaDate(new Date(row.expires_at)))],
  };
}

/**
 * A rejected grant, told to each side without ops' reason, which stays with the decision. The friend's goes with
 * their consent to WhatsApp about visits. The referrer's, like the message of a fit, needs none of its own: the
 * referrer is told (ADR 0025, "The messages people are owed").
 */
export async function composeReferralRejected(
  db: D1Database,
  attributionId: string,
  personId: string,
): Promise<Composed> {
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
