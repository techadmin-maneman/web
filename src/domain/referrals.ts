// Referral codes and who came through them (docs/decisions/0048-referrals.md). A code is the client's
// initials and six random characters, never from their mobile number, with no characters that look alike.
// A person is attributed once, to the first invite they used, and only while they are new: not the
// referrer, and not already fitted. An invite held for them on a waitlist lapses 12 months after their area
// launched; from then it carries no credits, and says so when they book.
//
// Ops may attach an invite to a client who booked away from its page, under the same rules and through the
// same function; who attached it and why are kept with it (docs/decisions/0089-an-invite-is-not-lost.md).

import { NAMING_NOTICES, type ToldNotice } from "../config/notices.ts";
import { inviteLapsed } from "../policy/invites.ts";
import { firstNameOf } from "../lib/names.ts";
import { auditStatementIfWritten, type AuditEntry } from "./audit.ts";
import { insertRow } from "../lib/sql.ts";

/** No 0, O, 1 or I: a code is read aloud and typed. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** About a billion codes for each pair of initials: too many to guess. */
const RANDOM_LENGTH = 6;

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

/**
 * A code's invite; null if no such code. An erased referrer's invite stays valid, with the house card. The referrer
 * is named only if their latest consent to cards was given on a notice that told them so: the profile's, or the
 * pay step's when booking gave it (ADR 0080).
 */
export async function inviteOf(db: D1Database, code: string, nameOnInvite: boolean): Promise<Invite | null> {
  const naming = NAMING_NOTICES.map((_, index) => `?${String(index + 2)}`).join(", ");
  const row = await db
    .prepare(
      `SELECT r.code, r.person_id, r.card_state, r.card_version, p.name, p.erased_at,
         (SELECT c.granted = 1 AND c.notice_version IN (${naming}) FROM consents c
          WHERE c.person_id = r.person_id AND c.purpose = 'photos_referral_cards'
          ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1) AS named
       FROM referral_codes r JOIN people p ON p.id = r.person_id WHERE r.code = ?1`,
    )
    .bind(code.toUpperCase(), ...NAMING_NOTICES)
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

/** The invite a client came with, while its free service visits still wait on their first fit. */
interface PendingInvite {
  /** As the invite's landing names them: null where it does not. */
  readonly referrerFirstName: string | null;
}

/** The invite a client came with, while it is pending and has not lapsed on a waitlist; else null. */
export async function pendingInviteOf(
  db: D1Database,
  personId: string,
  now: Date,
  nameOnInvite: boolean,
): Promise<PendingInvite | null> {
  const row = await db
    .prepare(
      `SELECT r.code, r.via, pin.launched_at FROM referral_attributions r
       LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode
       WHERE r.referred_person_id = ?1 AND r.grant_state = 'pending'`,
    )
    .bind(personId)
    .first<{ code: string; via: Via; launched_at: string | null }>();
  if (row === null) return null;
  const lapsed = row.via === "waitlist" && row.launched_at !== null && inviteLapsed(new Date(row.launched_at), now);
  if (lapsed) return null;
  const invite = await inviteOf(db, row.code, nameOnInvite);
  if (invite === null) return null;
  return { referrerFirstName: invite.referrerFirstName };
}

/**
 * An invite as it stands for the person who used it: valid; expired, when the one they were held under on a
 * waitlist lapsed (src/policy/invites.ts); or unknown, a code we do not have.
 */
export type InviteState = "valid" | "expired" | "unknown";

/** How a person reached us through an invite: a consultation booked or asked for, or a place on a waitlist. */
export type Via = "consultation" | "waitlist";

/** Who attached an invite by hand, and why, with the audit entry written in the same batch as the attribution. */
interface AttachedBy {
  readonly by: string;
  readonly reason: string;
  readonly audit: AuditEntry;
}

/**
 * What attributing a person to an invite came to. Refused, when the invite is their own or they are fitted already;
 * otherwise the invite they carry, attributed by this call or before it: this one, or another they came with first.
 */
type AttributionOutcome =
  | { readonly outcome: "own_invite" }
  | { readonly outcome: "fitted" }
  | {
      readonly outcome: "attributed" | "already_attributed";
      readonly code: string;
      /** Whether they now carry this invite's credits. */
      readonly credits: boolean;
      /** Whether this invite, held for them on a waitlist, has lapsed, and is marked so. */
      readonly lapsed: boolean;
    };

/**
 * Attributes a person to an invite, if they are new to referrals: not the referrer, not already attributed,
 * and, on their own link, not already fitted. Says whether they now carry the invite's credits, and whether the
 * invite they were held under has lapsed, which it is marked as, so it promises nothing more. It records the line
 * that told the friend their referrer hears of the fit, where the page showed one. An invite ops attach carries who
 * attached it and why, and its audit entry, written only if the attribution is; one ops attach after the friend's
 * first fit is held for their review (src/policy/fraud-holds.ts, LATE_ATTACH_RULE).
 */
export async function attribute(
  db: D1Database,
  input: {
    invite: Invite;
    personId: string;
    via: Via;
    pincode: string | null;
    toldNotice: ToldNotice | null;
    now: Date;
    attachedBy?: AttachedBy;
  },
): Promise<AttributionOutcome> {
  if (input.personId === input.invite.referrerId) return { outcome: "own_invite" };
  const fitted = await db
    .prepare(
      `SELECT id FROM appointments WHERE person_id = ?1 AND type = 'first_fit' AND status = 'completed'
         AND deleted_at IS NULL ORDER BY window_start LIMIT 1`,
    )
    .bind(input.personId)
    .first<{ id: string }>();
  const { attachedBy } = input;
  // A friend's own link never reaches someone already fitted; ops may, and the grant waits for their review.
  if (fitted !== null && attachedBy === undefined) return { outcome: "fitted" };
  const heldForReview = fitted === null ? null : { reason: "attached_after_fit" as const, firstFitId: fitted.id };
  const at = input.now.toISOString();
  const id = crypto.randomUUID();
  await db.batch([
    insertRow(
      db,
      "referral_attributions",
      {
        id,
        code: input.invite.code,
        referred_person_id: input.personId,
        first_touch_at: at,
        via: input.via,
        pincode: input.pincode,
        attached_by: attachedBy?.by ?? null,
        attach_reason: attachedBy?.reason ?? null,
        grant_state: heldForReview === null ? "pending" : "held",
        fraud_signals: heldForReview === null ? null : JSON.stringify([heldForReview.reason]),
        first_fit_appointment_id: heldForReview?.firstFitId ?? null,
        told_notice: input.toldNotice,
        created_at: at,
        updated_at: at,
      },
      "ON CONFLICT (referred_person_id) DO NOTHING",
    ),
    ...(attachedBy === undefined
      ? []
      : [auditStatementIfWritten(db, attachedBy.audit, input.now, { table: "referral_attributions", id })]),
  ]);
  const kept = await db
    .prepare(
      `SELECT r.id, r.code, r.grant_state, r.via, pin.launched_at FROM referral_attributions r
       LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode
       WHERE r.referred_person_id = ?1`,
    )
    .bind(input.personId)
    .first<{ id: string; code: string; grant_state: string; via: string; launched_at: string | null }>();
  if (kept === null) throw new Error("an attribution was written and is not there");
  const outcome = kept.id === id ? "attributed" : "already_attributed";
  if (kept.code !== input.invite.code) return { outcome, code: kept.code, credits: false, lapsed: false };
  if (kept.grant_state === "expired") return { outcome, code: kept.code, credits: false, lapsed: true };
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
    return { outcome, code: kept.code, credits: false, lapsed: true };
  }
  return { outcome, code: kept.code, credits: kept.grant_state === "pending", lapsed: false };
}

/** Whether person ?1 has had a visit, or booked or asked for one: in SQL, to sit in a query's SELECT. */
const ASKED_FOR_A_VISIT = `EXISTS (SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM slot_holds WHERE person_id = ?1)
  OR EXISTS (SELECT 1 FROM consultation_requests WHERE person_id = ?1)`;

/** Whether the person has had a visit, or booked or asked for one: a client already in the funnel. */
export async function hasAskedForAVisit(db: D1Database, personId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT ${ASKED_FOR_A_VISIT} AS asked`).bind(personId).first<{ asked: number }>();
  return row?.asked === 1;
}

/**
 * How a client ops attach an invite to reached us, as the landing would have recorded it: through the waitlist while
 * they wait on a list for an area we still do not serve, and have no visit booked or asked for; otherwise a
 * consultation. So the waitlist's lapse rule reaches only an invite held on a list before its area launched, and one
 * attached afterwards is not born lapsed. The pincode is the list's while they wait, else their address's, else the
 * list's they last joined.
 */
export async function howTheyCame(db: D1Database, personId: string): Promise<{ via: Via; pincode: string | null }> {
  const row = await db
    .prepare(
      `SELECT
         ${ASKED_FOR_A_VISIT} AS asked,
         (SELECT w.pincode FROM waitlist_entries w LEFT JOIN serviceable_pincodes pin ON pin.pincode = w.pincode
          WHERE w.person_id = ?1 AND COALESCE(pin.served, 0) = 0
          ORDER BY w.created_at DESC LIMIT 1) AS waiting_in,
         (SELECT pincode FROM waitlist_entries WHERE person_id = ?1 ORDER BY created_at DESC LIMIT 1) AS listed_in,
         (SELECT pincode FROM addresses WHERE person_id = ?1 AND replaced_at IS NULL
          ORDER BY created_at DESC LIMIT 1) AS lives_in`,
    )
    .bind(personId)
    .first<{ asked: number; waiting_in: string | null; listed_in: string | null; lives_in: string | null }>();
  if (row === null) return { via: "consultation", pincode: null };
  if (row.asked === 0 && row.waiting_in !== null) return { via: "waitlist", pincode: row.waiting_in };
  return { via: "consultation", pincode: row.lives_in ?? row.listed_in };
}

/** Where a referral's grant stands (migration 0021). */
export const GRANT_STATES = ["pending", "held", "approved", "rejected", "granted", "expired", "clawed_back"] as const;
type GrantState = (typeof GRANT_STATES)[number];

/** The invite a client came with, as ops read it on the client's page. */
interface ClientInvite {
  readonly code: string;
  /** Null once the referrer has been erased. */
  readonly referrer: { readonly id: string; readonly name: string } | null;
  readonly grant: GrantState;
  /** When they first came with it, or ops attached it. */
  readonly since: string;
  /** Null for an invite the client used themselves. */
  readonly attached: { readonly by: string; readonly reason: string | null } | null;
}

export async function clientInviteOf(db: D1Database, personId: string): Promise<ClientInvite | null> {
  const row = await db
    .prepare(
      `SELECT r.code, r.grant_state, r.first_touch_at, r.attached_by, r.attach_reason, p.id AS referrer_id,
         p.name AS referrer_name, p.erased_at AS referrer_erased_at
       FROM referral_attributions r JOIN referral_codes c ON c.code = r.code JOIN people p ON p.id = c.person_id
       WHERE r.referred_person_id = ?1`,
    )
    .bind(personId)
    .first<{
      code: string;
      grant_state: GrantState;
      first_touch_at: string;
      attached_by: string | null;
      attach_reason: string | null;
      referrer_id: string;
      referrer_name: string;
      referrer_erased_at: string | null;
    }>();
  if (row === null) return null;
  return {
    code: row.code,
    referrer: row.referrer_erased_at === null ? { id: row.referrer_id, name: row.referrer_name } : null,
    grant: row.grant_state,
    since: row.first_touch_at,
    attached: row.attached_by === null ? null : { by: row.attached_by, reason: row.attach_reason },
  };
}
