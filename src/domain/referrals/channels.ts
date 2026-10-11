// Referral channels: partners who send us clients on their own code, a salon, a clinic, a gym or a creator
// (docs/decisions/0123-partner-referral-channels.md). Growth adds each with the friend's reward and the partner's
// commission; the code opens the same invite page a client's does, naming the partner. A person comes through one
// invite only, a client's or a partner's, whichever they used first.

import { auditStatement, type AuditActor } from "../ops/audit.ts";
import type { DiscountKind, DiscountTerms } from "../../policy/discount-codes.ts";
import { inviteLapsed } from "../../policy/invites.ts";
import { OWED } from "./partner-statements.ts";
import { inviteOf, newReferralCode, type Invite, type Via } from "./referrals.ts";

/** A partner's invite, as the landing and its forms read it. */
export interface PartnerInvite {
  readonly kind: "partner";
  readonly code: string;
  readonly channelId: string;
  readonly partnerName: string;
  /** The service visits the friend gets once fitted; 0 for none. */
  readonly friendVisits: number;
  /** The partner's discount code, which comes off the friend's first fit by itself, and its terms; null for none. */
  readonly discount: { readonly code: string; readonly terms: DiscountTerms } | null;
}

interface PartnerRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly friend_visits: number;
  readonly discount_code: string | null;
  readonly kind: DiscountKind | null;
  readonly value: number | null;
  readonly cap: number | null;
}

/**
 * A live partner's invite by its code; null for a code no partner has, or one paused. Its discount code stands while
 * it is switched on, covers a first fit and, given `today`, has not ended.
 */
export async function partnerInviteOf(
  db: D1Database,
  code: string,
  today: string | null = null,
): Promise<PartnerInvite | null> {
  const row = await db
    .prepare(
      `SELECT c.id, c.code, c.name, c.friend_visits, d.code AS discount_code, d.kind, d.value, d.cap
       FROM referral_channels c
       LEFT JOIN discount_codes d ON d.id = c.discount_code_id AND d.switched_off_at IS NULL AND d.covers_first_fit = 1
         AND (?2 IS NULL OR d.expires_on IS NULL OR d.expires_on >= ?2)
       WHERE c.code = ?1 AND c.paused_at IS NULL`,
    )
    .bind(code.toUpperCase(), today)
    .first<PartnerRow>();
  if (row === null) return null;
  return {
    kind: "partner",
    code: row.code,
    channelId: row.id,
    partnerName: row.name,
    friendVisits: row.friend_visits,
    discount:
      row.discount_code === null || row.kind === null || row.value === null
        ? null
        : { code: row.discount_code, terms: { kind: row.kind, value: row.value, cap: row.cap } },
  };
}

/** Whether a person already came through a client's invite. */
const throughAClient = async (db: D1Database, personId: string): Promise<boolean> =>
  (await db.prepare("SELECT 1 FROM referral_attributions WHERE referred_person_id = ?1").bind(personId).first()) !==
  null;

type PartnerOutcome =
  | { readonly outcome: "fitted" }
  | {
      readonly outcome: "attributed" | "already_attributed";
      /** Whether they now carry this partner's reward for the friend. */
      readonly credits: boolean;
      /** Whether this invite, held for them on a waitlist, has lapsed, and is marked so. */
      readonly lapsed: boolean;
    };

/**
 * Attributes a person to a partner's invite, if they are new to referrals: not already fitted, and not already
 * through any invite. Says whether they now carry the partner's reward, and whether the invite they were held under
 * on a waitlist has lapsed, which it is then marked as.
 */
export async function attributeToPartner(
  db: D1Database,
  input: { invite: PartnerInvite; personId: string; via: Via; pincode: string | null; now: Date },
): Promise<PartnerOutcome> {
  const fitted = await db
    .prepare(
      `SELECT 1 FROM appointments WHERE person_id = ?1 AND type = 'first_fit' AND status = 'completed'
         AND deleted_at IS NULL LIMIT 1`,
    )
    .bind(input.personId)
    .first();
  if (fitted !== null) return { outcome: "fitted" };
  if (await throughAClient(db, input.personId)) return { outcome: "already_attributed", credits: false, lapsed: false };
  const at = input.now.toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO channel_attributions (id, channel_id, referred_person_id, first_touch_at, via, pincode, created_at,
         updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?4) ON CONFLICT (referred_person_id) DO NOTHING`,
    )
    .bind(id, input.invite.channelId, input.personId, at, input.via, input.pincode)
    .run();
  const kept = await db
    .prepare(
      `SELECT r.id, r.channel_id, r.grant_state, r.via, pin.launched_at FROM channel_attributions r
       LEFT JOIN serviceable_pincodes pin ON pin.pincode = r.pincode WHERE r.referred_person_id = ?1`,
    )
    .bind(input.personId)
    .first<{ id: string; channel_id: string; grant_state: string; via: string; launched_at: string | null }>();
  if (kept === null) throw new Error("a partner's attribution was written and is not there");
  const outcome = kept.id === id ? "attributed" : "already_attributed";
  if (kept.channel_id !== input.invite.channelId) return { outcome, credits: false, lapsed: false };
  if (kept.grant_state === "expired") return { outcome, credits: false, lapsed: true };
  const lapsedOnWaitlist =
    kept.grant_state === "pending" &&
    kept.via === "waitlist" &&
    kept.launched_at !== null &&
    inviteLapsed(new Date(kept.launched_at), input.now);
  if (lapsedOnWaitlist) {
    await db
      .prepare("UPDATE channel_attributions SET grant_state = 'expired', updated_at = ?2 WHERE id = ?1")
      .bind(kept.id, at)
      .run();
    return { outcome, credits: false, lapsed: true };
  }
  return { outcome, credits: kept.grant_state === "pending" && input.invite.friendVisits > 0, lapsed: false };
}

export interface ChannelTerms {
  readonly name: string;
  readonly friendVisits: number;
  readonly validDays: number;
  /** Paise for each friend fitted. */
  readonly commission: number;
  /** One of Finance's codes, as typed, for the friend's first paid visit; null for none. */
  readonly discountCode: string | null;
}

/**
 * A partner's code, as typed, as the ID of a code Finance made, has not switched off and that covers a first fit;
 * null for none given.
 */
async function discountCodeId(db: D1Database, text: string | null): Promise<{ readonly id: string | null } | null> {
  if (text === null) return { id: null };
  const row = await db
    .prepare(
      "SELECT id FROM discount_codes WHERE code = upper(?1) AND switched_off_at IS NULL AND covers_first_fit = 1",
    )
    .bind(text)
    .first<{ id: string }>();
  return row === null ? null : { id: row.id };
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

const nameTaken = async (db: D1Database, name: string, except: string | null): Promise<boolean> =>
  (await db
    .prepare("SELECT 1 FROM referral_channels WHERE lower(name) = lower(?1) AND id IS NOT ?2")
    .bind(name, except)
    .first()) !== null;

/** A code no partner and no client has, made from the partner's name as a client's is from theirs. */
async function freeCode(db: D1Database, name: string): Promise<string> {
  for (let tries = 0; tries < 5; tries += 1) {
    const code = newReferralCode(name);
    const taken = await db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM referral_codes WHERE code = ?1)
           OR EXISTS (SELECT 1 FROM referral_channels WHERE code = ?1) AS taken`,
      )
      .bind(code)
      .first<{ taken: number }>();
    if (taken?.taken !== 1) return code;
  }
  throw new Error("could not find a free partner code");
}

/** What an audit entry keeps of a partner's terms: figures and IDs, never its name. */
const termsDetail = (terms: ChannelTerms, codeId: string | null) => ({
  friend_visits: terms.friendVisits,
  valid_days: terms.validDays,
  commission: terms.commission,
  discount_code_id: codeId,
});

export async function addChannel(
  db: D1Database,
  change: Change & ChannelTerms,
): Promise<{ readonly outcome: "taken" | "no_code" } | { readonly outcome: "added"; readonly id: string }> {
  if (await nameTaken(db, change.name, null)) return { outcome: "taken" };
  const discount = await discountCodeId(db, change.discountCode);
  if (discount === null) return { outcome: "no_code" };
  const id = crypto.randomUUID();
  const code = await freeCode(db, change.name);
  await db.batch([
    db
      .prepare(
        `INSERT INTO referral_channels (id, name, code, friend_visits, valid_days, commission, discount_code_id,
           created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        id,
        change.name,
        code,
        change.friendVisits,
        change.validDays,
        change.commission,
        discount.id,
        change.actor.id,
        change.now.toISOString(),
      ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "channel.add",
        subject: { kind: "referral_channel", id },
        requestId: change.requestId,
        detail: termsDetail(change, discount.id),
      },
      change.now,
    ),
  ]);
  return { outcome: "added", id };
}

/** Changes a partner's name or terms. The terms in force when a friend is fitted are the ones that friend earns. */
export async function changeChannel(
  db: D1Database,
  change: Change & ChannelTerms & { readonly id: string },
): Promise<"not_found" | "taken" | "no_code" | "changed"> {
  const exists = await db.prepare("SELECT 1 FROM referral_channels WHERE id = ?1").bind(change.id).first();
  if (exists === null) return "not_found";
  if (await nameTaken(db, change.name, change.id)) return "taken";
  const discount = await discountCodeId(db, change.discountCode);
  if (discount === null) return "no_code";
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE referral_channels SET name = ?2, friend_visits = ?3, valid_days = ?4, commission = ?5,
           discount_code_id = ?6, changed_by = ?7, changed_at = ?8 WHERE id = ?1`,
      )
      .bind(
        change.id,
        change.name,
        change.friendVisits,
        change.validDays,
        change.commission,
        discount.id,
        change.actor.id,
        at,
      ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "channel.change",
        subject: { kind: "referral_channel", id: change.id },
        requestId: change.requestId,
        detail: termsDetail(change, discount.id),
      },
      change.now,
    ),
  ]);
  return "changed";
}

/** Pauses a partner, so nobody new comes through their code, or takes the pause off. */
export async function pauseChannel(
  db: D1Database,
  change: Change & { readonly id: string; readonly paused: boolean },
): Promise<"not_found" | "set"> {
  const at = change.now.toISOString();
  const [updated] = await db.batch([
    db
      .prepare("UPDATE referral_channels SET paused_at = ?2, changed_by = ?3, changed_at = ?4 WHERE id = ?1")
      .bind(change.id, change.paused ? at : null, change.actor.id, at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: change.paused ? "channel.pause" : "channel.resume",
        subject: { kind: "referral_channel", id: change.id },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
  return updated?.meta.changes === 1 ? "set" : "not_found";
}

export interface Channel {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly friend_visits: number;
  readonly valid_days: number;
  readonly commission: number;
  readonly paused_at: string | null;
  readonly opens: number;
  /** People who came through the code: booked or asked for a consultation, or joined a waitlist. */
  readonly referred: number;
  /** Of those, fitted, with the friend's reward given and the commission earned. */
  readonly fitted: number;
  /** Paise earned, from each friend fitted, at the commission in force then. */
  readonly earned: number;
  /** Of that, paise not yet paid (./partner-statements.ts). */
  readonly owed: number;
  /** The partner's discount code for the friend's first paid visit; null for none. */
  readonly discount_code: string | null;
}

/** Every partner, newest first, with what has come through each. */
export async function listChannels(db: D1Database): Promise<Channel[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, c.code, c.friend_visits, c.valid_days, c.commission, c.paused_at, c.opens,
         (SELECT COUNT(*) FROM channel_attributions a WHERE a.channel_id = c.id) AS referred,
         (SELECT COUNT(*) FROM channel_attributions a WHERE a.channel_id = c.id AND a.grant_state = 'granted') AS fitted,
         (SELECT COALESCE(SUM(a.commission), 0) FROM channel_attributions a
          WHERE a.channel_id = c.id AND a.grant_state = 'granted') AS earned,
         ${OWED} AS owed,
         (SELECT d.code FROM discount_codes d WHERE d.id = c.discount_code_id) AS discount_code
       FROM referral_channels c ORDER BY c.created_at DESC`,
    )
    .all<Channel>();
  return results;
}

/** An invite a link carries: a client's, or a partner's. */
export type AnyInvite = Invite | PartnerInvite;

export const isPartnerInvite = (invite: AnyInvite): invite is PartnerInvite => "channelId" in invite;

/** The invite behind a code: a client's, else a live partner's; null for a code we do not have. */
export async function anyInviteOf(
  db: D1Database,
  code: string,
  nameOnInvite: boolean,
  today: string | null = null,
): Promise<AnyInvite | null> {
  return (await inviteOf({ db, code, nameOnInvite })) ?? (await partnerInviteOf(db, code, today));
}

/** The client's code an invite carries, for the tables that point at clients' codes; null for a partner's. */
export const clientCodeOf = (invite: AnyInvite | null): string | null =>
  invite === null || isPartnerInvite(invite) ? null : invite.code;

/**
 * The partner's code for a friend it sent who is not fitted yet, where the partner has one switched on; null for
 * anyone else. Their first fit takes it by itself (docs/decisions/0125-partner-discount-codes.md).
 */
export async function partnerCodeFor(db: D1Database, personId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT d.code FROM channel_attributions a
       JOIN referral_channels c ON c.id = a.channel_id
       JOIN discount_codes d ON d.id = c.discount_code_id AND d.switched_off_at IS NULL AND d.covers_first_fit = 1
       WHERE a.referred_person_id = ?1 AND a.grant_state = 'pending'`,
    )
    .bind(personId)
    .first<{ code: string }>();
  return row?.code ?? null;
}
