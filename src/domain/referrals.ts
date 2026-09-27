// Referral codes and who came through them (docs/decisions/0048-referrals.md). A code is the client's
// initials and four random characters, never from their mobile number, with no characters that look alike.
// A person is attributed once, to the first invite they used, and only while they are new: not the
// referrer, and not already fitted. An invite held for them on a waitlist lapses 12 months after their area
// launched; from then it carries no credits, and says so when they book.

import { CURRENT_NOTICE } from "../config/notices.ts";
import { inviteLapsed } from "../policy/invites.ts";
import { firstNameOf } from "../lib/names.ts";

/** No 0, O, 1 or I: a code is read aloud and typed. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RANDOM_LENGTH = 4;

export function newReferralCode(name: string): string {
  const initials =
    name
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z]/g, "").charAt(0))
      .filter((letter) => letter !== "")
      .slice(0, 2)
      .join("")
      .toUpperCase()
      .replace(/[OI]/g, "X") || "MM";
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
  return initials + [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length] ?? "X").join("");
}

/** The client's code, made the first time they ask for it. */
export async function referralCodeOf(db: D1Database, personId: string, name: string, now: Date): Promise<string> {
  const existing = await db
    .prepare("SELECT code FROM referral_codes WHERE person_id = ?1")
    .bind(personId)
    .first<{ code: string }>();
  if (existing !== null) return existing.code;
  const at = now.toISOString();
  for (let tries = 0; tries < 5; tries += 1) {
    const made = await db
      .prepare(
        `INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT DO NOTHING RETURNING code`,
      )
      .bind(newReferralCode(name), personId, at)
      .first<{ code: string }>();
    if (made !== null) return made.code;
    // Either the code was taken, or another request made this person's code meanwhile.
    const raced = await db
      .prepare("SELECT code FROM referral_codes WHERE person_id = ?1")
      .bind(personId)
      .first<{ code: string }>();
    if (raced !== null) return raced.code;
  }
  throw new Error("could not find a free referral code");
}

export interface Invite {
  readonly code: string;
  readonly referrerId: string;
  /** Shown only if the referrer agreed to it, and REFERRER_NAME_ON_INVITE is on. */
  readonly referrerFirstName: string | null;
  readonly card: { readonly state: "house" | "personal"; readonly version: number };
}

/** A code's invite; null if no such code. An erased referrer's invite stays valid, with the house card. */
export async function inviteOf(db: D1Database, code: string, nameOnInvite: boolean): Promise<Invite | null> {
  const row = await db
    .prepare(
      `SELECT r.code, r.person_id, r.card_state, r.card_version, p.name, p.erased_at,
         (SELECT c.granted = 1 AND c.notice_version = ?2 FROM consents c
          WHERE c.person_id = r.person_id AND c.purpose = 'photos_referral_cards'
          ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1) AS named
       FROM referral_codes r JOIN people p ON p.id = r.person_id WHERE r.code = ?1`,
    )
    .bind(code.toUpperCase(), CURRENT_NOTICE.photos_referral_cards)
    .first<{
      code: string;
      person_id: string;
      card_state: "house" | "personal";
      card_version: number;
      name: string;
      erased_at: string | null;
      named: number | null;
    }>();
  if (row === null) return null;
  const erased = row.erased_at !== null;
  return {
    code: row.code,
    referrerId: row.person_id,
    referrerFirstName: nameOnInvite && !erased && row.named === 1 ? firstNameOf(row.name) : null,
    card: { state: erased ? "house" : row.card_state, version: row.card_version },
  };
}

/**
 * An invite as it stands for the person who used it: valid; expired, when the one they were held under on a
 * waitlist lapsed (src/policy/invites.ts); or unknown, a code we do not have.
 */
export type InviteState = "valid" | "expired" | "unknown";

/**
 * Attributes a person to an invite, if they are new to referrals: not the referrer, not already attributed,
 * and not already fitted. Says whether they now carry the invite's credits, and whether the invite they were
 * held under has lapsed, which it is marked as, so it promises nothing more.
 */
export async function attribute(
  db: D1Database,
  input: { invite: Invite; personId: string; via: "consultation" | "waitlist"; pincode: string | null; now: Date },
): Promise<{ readonly credits: boolean; readonly lapsed: boolean }> {
  const none = { credits: false, lapsed: false };
  if (input.personId === input.invite.referrerId) return none;
  const fitted = await db
    .prepare(
      `SELECT 1 FROM appointments WHERE person_id = ?1 AND type = 'first_fit' AND status = 'completed'
         AND deleted_at IS NULL LIMIT 1`,
    )
    .bind(input.personId)
    .first();
  if (fitted !== null) return none;
  const at = input.now.toISOString();
  await db
    .prepare(
      `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, pincode, created_at,
         updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?4)
       ON CONFLICT (referred_person_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), input.invite.code, input.personId, at, input.via, input.pincode)
    .run();
  const kept = await db
    .prepare(
      `SELECT r.id, r.code, r.grant_state, r.via, pin.launched_at FROM referral_attributions r
       LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode
       WHERE r.referred_person_id = ?1`,
    )
    .bind(input.personId)
    .first<{ id: string; code: string; grant_state: string; via: string; launched_at: string | null }>();
  if (kept?.code !== input.invite.code) return none;
  if (kept.grant_state === "expired") return { credits: false, lapsed: true };
  // An invite held on a waitlist lasts until 12 months after the area launched.
  const lapsedOnWaitlist =
    kept.grant_state === "pending" &&
    kept.via === "waitlist" &&
    kept.launched_at !== null &&
    inviteLapsed(new Date(kept.launched_at), input.now);
  if (lapsedOnWaitlist) {
    await db
      .prepare("UPDATE referral_attributions SET grant_state = 'expired', updated_at = ?2 WHERE id = ?1")
      .bind(kept.id, at)
      .run();
    return { credits: false, lapsed: true };
  }
  return { credits: kept.grant_state === "pending", lapsed: false };
}
