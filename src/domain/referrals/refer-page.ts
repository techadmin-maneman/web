// What the app's Refer page reads (src/routes/client/refer.ts): the client's code, made the first time they need one,
// their card, the friends fitted through them, and how they came themselves.

import { referralCodeOf } from "./referrals.ts";

/** The client's code, made from their initials the first time they need one. */
export async function codeOf(db: D1Database, personId: string, now: Date): Promise<string> {
  const person = await db.prepare("SELECT name FROM people WHERE id = ?1").bind(personId).first<{ name: string }>();
  return referralCodeOf(db, personId, person?.name ?? "", now);
}

/** The card the code carries: the house's, or one of their own, at its version. */
export function cardOf(db: D1Database, code: string) {
  return db
    .prepare("SELECT card_state, card_version FROM referral_codes WHERE code = ?1")
    .bind(code)
    .first<{ card_state: "house" | "personal"; card_version: number }>();
}

/** A friend fitted through the code, as Refer lists them, with the visits their grant gave the client. */
export interface FittedFriend {
  friend_first_name: string | null;
  name: string;
  erased_at: string | null;
  window_start: string;
  visits: number | null;
}

/** The friends fitted through the code whose credit is approved or granted, the latest fitted first. */
export async function fittedFriends(db: D1Database, code: string, personId: string): Promise<FittedFriend[]> {
  const { results } = await db
    .prepare(
      `SELECT r.friend_first_name, p.name, p.erased_at, a.window_start, g.visits FROM referral_attributions r
       JOIN people p ON p.id = r.referred_person_id JOIN appointments a ON a.id = r.first_fit_appointment_id
       LEFT JOIN credit_ledger g ON g.kind = 'grant' AND g.source_kind = 'referral' AND g.source_id = r.id
         AND g.person_id = ?2
       WHERE r.code = ?1 AND r.grant_state IN ('approved', 'granted') ORDER BY a.window_start DESC`,
    )
    .bind(code, personId)
    .all<FittedFriend>();
  return results;
}

/** How the client came themselves, where a friend invited them: the grant's state, and the visits it gave. */
export function invitedAs(db: D1Database, personId: string) {
  return db
    .prepare("SELECT grant_state, friend_visits FROM referral_attributions WHERE referred_person_id = ?1")
    .bind(personId)
    .first<{ grant_state: string; friend_visits: number | null }>();
}
