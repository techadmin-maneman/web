// Referral channels: partners who send us clients on their own code, a salon, a clinic, a gym or a creator
// (docs/decisions/0123-partner-referral-channels.md). Growth adds each with the friend's reward and the partner's
// commission; the code opens the same invite page a client's does, naming the partner. A person comes through one
// invite only, a client's or a partner's, whichever they used first.

import { auditStatement, type AuditActor } from "../ops/audit.ts";
import { inviteLapsed } from "../../policy/invites.ts";
import { inviteOf, newReferralCode, type Invite, type Via } from "./referrals.ts";

/** A partner's invite, as the landing and its forms read it. */
export interface PartnerInvite {
  readonly kind: "partner";
  readonly code: string;
  readonly channelId: string;
  readonly partnerName: string;
  /** The service visits the friend gets once fitted; 0 for none. */
  readonly friendVisits: number;
}

/** A live partner's invite by its code; null for a code no partner has, or one paused. */
export async function partnerInviteOf(db: D1Database, code: string): Promise<PartnerInvite | null> {
  const row = await db
    .prepare("SELECT id, code, name, friend_visits FROM referral_channels WHERE code = ?1 AND paused_at IS NULL")
    .bind(code.toUpperCase())
    .first<{ id: string; code: string; name: string; friend_visits: number }>();
  if (row === null) return null;
  return { kind: "partner", code: row.code, channelId: row.id, partnerName: row.name, friendVisits: row.friend_visits };
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

export async function addChannel(
  db: D1Database,
  change: Change & ChannelTerms,
): Promise<{ readonly outcome: "taken" } | { readonly outcome: "added"; readonly id: string }> {
  if (await nameTaken(db, change.name, null)) return { outcome: "taken" };
  const id = crypto.randomUUID();
  const code = await freeCode(db, change.name);
  await db.batch([
    db
      .prepare(
        `INSERT INTO referral_channels (id, name, code, friend_visits, valid_days, commission, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        id,
        change.name,
        code,
        change.friendVisits,
        change.validDays,
        change.commission,
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
        detail: { friend_visits: change.friendVisits, valid_days: change.validDays, commission: change.commission },
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
): Promise<"not_found" | "taken" | "changed"> {
  const exists = await db.prepare("SELECT 1 FROM referral_channels WHERE id = ?1").bind(change.id).first();
  if (exists === null) return "not_found";
  if (await nameTaken(db, change.name, change.id)) return "taken";
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE referral_channels SET name = ?2, friend_visits = ?3, valid_days = ?4, commission = ?5, changed_by = ?6,
           changed_at = ?7 WHERE id = ?1`,
      )
      .bind(change.id, change.name, change.friendVisits, change.validDays, change.commission, change.actor.id, at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "channel.change",
        subject: { kind: "referral_channel", id: change.id },
        requestId: change.requestId,
        detail: { friend_visits: change.friendVisits, valid_days: change.validDays, commission: change.commission },
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
}

/** Every partner, newest first, with what has come through each. */
export async function listChannels(db: D1Database): Promise<Channel[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, c.code, c.friend_visits, c.valid_days, c.commission, c.paused_at, c.opens,
         (SELECT COUNT(*) FROM channel_attributions a WHERE a.channel_id = c.id) AS referred,
         (SELECT COUNT(*) FROM channel_attributions a WHERE a.channel_id = c.id AND a.grant_state = 'granted') AS fitted,
         (SELECT COALESCE(SUM(a.commission), 0) FROM channel_attributions a
          WHERE a.channel_id = c.id AND a.grant_state = 'granted') AS earned
       FROM referral_channels c ORDER BY c.created_at DESC`,
    )
    .all<Channel>();
  return results;
}

/** An invite a link carries: a client's, or a partner's. */
export type AnyInvite = Invite | PartnerInvite;

export const isPartnerInvite = (invite: AnyInvite): invite is PartnerInvite => "channelId" in invite;

/** The invite behind a code: a client's, else a live partner's; null for a code we do not have. */
export async function anyInviteOf(db: D1Database, code: string, nameOnInvite: boolean): Promise<AnyInvite | null> {
  return (await inviteOf({ db, code, nameOnInvite })) ?? (await partnerInviteOf(db, code));
}

/** The client's code an invite carries, for the tables that point at clients' codes; null for a partner's. */
export const clientCodeOf = (invite: AnyInvite | null): string | null =>
  invite === null || isPartnerInvite(invite) ? null : invite.code;
