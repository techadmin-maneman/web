// Referral codes and who came through them (docs/decisions/0048-referrals.md). A code is the client's
// initials and four random characters, never from their mobile number, with no characters that look alike.
// A person is attributed once, to the first invite they used, and only while they are new: not the
// referrer, and not already fitted.

import { CURRENT_NOTICE } from "../config/notices.ts";

/** No 0, O, 1 or I: a code is read aloud and typed. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RANDOM_LENGTH = 4;

export function newCode(name: string): string {
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
      .bind(newCode(name), personId, at)
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
    referrerFirstName: nameOnInvite && !erased && row.named === 1 ? (row.name.split(" ")[0] ?? null) : null,
    card: { state: erased ? "house" : row.card_state, version: row.card_version },
  };
}

/**
 * Attributes a person to an invite, if they are new to referrals: not the referrer, not already attributed,
 * and not already fitted. Returns whether they now carry the invite's credits.
 */
export async function attribute(
  db: D1Database,
  input: { invite: Invite; personId: string; via: "consultation" | "waitlist"; pincode: string | null; now: Date },
): Promise<boolean> {
  if (input.personId === input.invite.referrerId) return false;
  const fitted = await db
    .prepare(
      `SELECT 1 FROM appointments WHERE person_id = ?1 AND type = 'first_fit' AND status = 'completed'
         AND deleted_at IS NULL LIMIT 1`,
    )
    .bind(input.personId)
    .first();
  if (fitted !== null) return false;
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
    .prepare("SELECT code, grant_state FROM referral_attributions WHERE referred_person_id = ?1")
    .bind(input.personId)
    .first<{ code: string; grant_state: string }>();
  return kept?.code === input.invite.code && kept.grant_state === "pending";
}
