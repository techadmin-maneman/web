// Touches (docs/decisions/0288-attribution-and-conversions.md): everything that reached us carrying something about
// where it came from, a page of the site, a WhatsApp chat or a call, each with its channel by the rule
// (src/policy/channels.ts). A touch is a person's once their number names it: at once where we know who it is, else
// when a form they send, or Care's saving of their chat, says so.

import { CODE_PATTERN } from "../../config/invite-codes.ts";
import { FBC_PATTERN, fbcOf, FBP_PATTERN } from "../../lib/ad-match.ts";
import {
  carriesCampaign,
  touchChannel,
  type ChannelCode,
  type TouchCode,
  type TouchVia,
} from "../../policy/channels.ts";
import { refreshAttribution, withAttribution } from "./attribution.ts";

/** What a touch carried, as the site, the WhatsApp webhook or the console gives it: each field null where absent. */
export interface Carried {
  readonly utm_source: string | null;
  readonly utm_medium: string | null;
  readonly utm_campaign: string | null;
  readonly utm_content: string | null;
  readonly utm_term: string | null;
  readonly gclid: string | null;
  readonly gbraid: string | null;
  readonly wbraid: string | null;
  readonly fbclid: string | null;
  readonly fbc: string | null;
  readonly fbp: string | null;
  readonly ctwa_clid: string | null;
  readonly ad_source_id: string | null;
  readonly ad_source_url: string | null;
  readonly referrer: string | null;
  readonly landing_path: string | null;
}

export const NOTHING_CARRIED: Carried = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  fbc: null,
  fbp: null,
  ctwa_clid: null,
  ad_source_id: null,
  ad_source_url: null,
  referrer: null,
  landing_path: null,
};

/** The codes a landing carried: a friend's or a partner's (?ref), a society's (?soc) and an offer link's (?offer). */
export interface Codes {
  readonly ref: string | null;
  readonly soc: string | null;
  readonly offer: string | null;
}

export const NO_CODES: Codes = { ref: null, soc: null, offer: null };

/** What the codes are, as we hold them: the code kind for the channel rule, the link, and the invite as given. */
interface Resolved {
  readonly inviteCode: string | null;
  readonly codeKind: TouchCode | null;
  readonly linkId: string | null;
}

/** Each code looked up; one we do not hold, or one paused or retired, counts as none. */
export async function resolveCodes(db: D1Database, codes: Codes): Promise<Resolved> {
  const ref = codes.ref !== null && CODE_PATTERN.test(codes.ref) ? codes.ref.toUpperCase() : null;
  const [friend, partner, society, offer] = await Promise.all([
    ref === null ? null : db.prepare("SELECT 1 FROM referral_codes WHERE code = ?1").bind(ref).first(),
    ref === null
      ? null
      : db.prepare("SELECT 1 FROM referral_channels WHERE code = ?1 AND paused_at IS NULL").bind(ref).first(),
    linkWith(db, "society", codes.soc),
    linkWith(db, "offer", codes.offer),
  ]);
  let inviteKind: TouchCode | null = null;
  if (friend !== null) inviteKind = "friend";
  else if (partner !== null) inviteKind = "partner";
  return {
    inviteCode: inviteKind === null ? null : ref,
    codeKind: inviteKind ?? (society === null ? null : "society"),
    linkId: society ?? offer,
  };
}

async function linkWith(db: D1Database, kind: "society" | "offer", code: string | null): Promise<string | null> {
  if (code === null || !/^[A-Za-z0-9]{3,16}$/.test(code)) return null;
  const row = await db
    .prepare("SELECT id FROM campaign_links WHERE kind = ?1 AND code = ?2 AND retired_at IS NULL")
    .bind(kind, code.toUpperCase())
    .first<{ id: string }>();
  return row?.id ?? null;
}

export interface NewTouch {
  readonly at: Date;
  readonly via: TouchVia;
  readonly visitorId: string | null;
  readonly personId: string | null;
  /** A chat's number, kept while no person has it. */
  readonly mobileE164: string | null;
  readonly carried: Carried;
  readonly resolved: Resolved;
  readonly declared: { readonly channel: ChannelCode; readonly by: "ops" | "number" } | null;
  /** The visitor's answer to the cookie bar; denied keeps Meta's cookies and the address from being stored at all. */
  readonly adConsent: "granted" | "denied" | null;
  readonly userAgent: string | null;
  readonly clientIp: string | null;
}

export interface RecordedTouch {
  readonly id: string;
  readonly channel: ChannelCode;
  readonly campaign: boolean;
}

/** Meta's click cookie as the browser had it, else built from its click ID; none where the visitor declined. */
function fbcFor(touch: NewTouch): string | null {
  if (touch.adConsent === "denied") return null;
  const given = touch.carried.fbc;
  if (given !== null && FBC_PATTERN.test(given)) return given;
  return touch.carried.fbclid === null ? null : fbcOf(touch.carried.fbclid, touch.at);
}

/**
 * The touch's row, for a caller to write in a batch of its own, and what it is recorded as. It names its visitor only
 * where the visitor's row is there: a page's report of its landing may never have arrived.
 */
export function touchStatement(
  db: D1Database,
  touch: NewTouch,
): { readonly statement: D1PreparedStatement; readonly recorded: RecordedTouch } {
  const { carried, resolved } = touch;
  const fields = {
    utmSource: carried.utm_source,
    utmMedium: carried.utm_medium,
    utmCampaign: carried.utm_campaign,
    gclid: carried.gclid,
    gbraid: carried.gbraid,
    wbraid: carried.wbraid,
    fbclid: carried.fbclid,
    ctwaClid: carried.ctwa_clid,
    referrer: carried.referrer,
    code: resolved.codeKind,
    declared: touch.declared?.channel ?? null,
    via: touch.via,
  };
  const recorded: RecordedTouch = {
    id: crypto.randomUUID(),
    channel: touchChannel(fields),
    campaign: carriesCampaign(fields) || resolved.linkId !== null,
  };
  const denied = touch.adConsent === "denied";
  const fbp = !denied && carried.fbp !== null && FBP_PATTERN.test(carried.fbp) ? carried.fbp : null;
  const statement = db
    .prepare(
      `INSERT INTO touches (id, at, via, visitor_id, person_id, mobile_e164, utm_source, utm_medium, utm_campaign,
         utm_content, utm_term, gclid, gbraid, wbraid, fbclid, fbc, fbp, ctwa_clid, ad_source_id, ad_source_url,
         referrer, landing_path, invite_code, code_kind, link_id, declared_channel, declared_by, channel,
         campaign_signal, ad_consent, user_agent, client_ip)
       VALUES (?1, ?2, ?3, (SELECT id FROM visitors WHERE id = ?4), ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22,
         ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32)`,
    )
    .bind(
      recorded.id,
      touch.at.toISOString(),
      touch.via,
      touch.visitorId,
      touch.personId,
      touch.personId === null ? touch.mobileE164 : null,
      carried.utm_source,
      carried.utm_medium,
      carried.utm_campaign,
      carried.utm_content,
      carried.utm_term,
      carried.gclid,
      carried.gbraid,
      carried.wbraid,
      carried.fbclid,
      fbcFor(touch),
      fbp,
      carried.ctwa_clid,
      carried.ad_source_id,
      carried.ad_source_url,
      carried.referrer,
      carried.landing_path,
      resolved.inviteCode,
      resolved.codeKind,
      resolved.linkId,
      touch.declared?.channel ?? null,
      touch.declared?.by ?? null,
      recorded.channel,
      recorded.campaign ? 1 : 0,
      touch.adConsent,
      denied ? null : touch.userAgent,
      denied ? null : touch.clientIp,
    );
  return { statement, recorded };
}

/** Records the touch, and, where its person is known, brings their first and last touch up to date. */
export async function recordTouch(db: D1Database, touch: NewTouch): Promise<RecordedTouch> {
  const { statement, recorded } = touchStatement(db, touch);
  if (touch.personId === null) await statement.run();
  else await withAttribution(db, touch.personId, [statement], touch.at);
  return recorded;
}

/** The writes that make a visitor's touches a person's, for a caller's batch. */
export const claimStatements = (db: D1Database, visitorId: string, personId: string): D1PreparedStatement[] => [
  db.prepare("UPDATE visitors SET person_id = ?2 WHERE id = ?1 AND person_id IS NULL").bind(visitorId, personId),
  db
    .prepare("UPDATE touches SET person_id = ?2, mobile_e164 = NULL WHERE visitor_id = ?1 AND person_id IS NULL")
    .bind(visitorId, personId),
];

/** The number's touches no one held: the chats it sent before its person was known. */
const UNCLAIMED_OF_NUMBER = "person_id IS NULL AND mobile_e164 = (SELECT mobile_e164 FROM people WHERE id = ?1)";

/**
 * The writes that make a person's own the touches their number made before we knew them, a chat's, and the visitors
 * those chats named by their reference with those visitors' touches: for a caller's batch.
 */
export const numberClaimStatements = (db: D1Database, personId: string): D1PreparedStatement[] => [
  db
    .prepare(
      `UPDATE visitors SET person_id = ?1 WHERE person_id IS NULL AND id IN
         (SELECT visitor_id FROM touches WHERE visitor_id IS NOT NULL AND ${UNCLAIMED_OF_NUMBER})`,
    )
    .bind(personId),
  db
    .prepare(
      `UPDATE touches SET person_id = ?1, mobile_e164 = NULL
       WHERE person_id IS NULL AND visitor_id IN (SELECT id FROM visitors WHERE person_id = ?1)`,
    )
    .bind(personId),
  db.prepare(`UPDATE touches SET person_id = ?1, mobile_e164 = NULL WHERE ${UNCLAIMED_OF_NUMBER}`).bind(personId),
];

/** Makes a visitor's touches a person's, once a number they gave names them. */
export async function claimVisitor(db: D1Database, visitorId: string, personId: string, now: Date): Promise<void> {
  await withAttribution(db, personId, claimStatements(db, visitorId, personId), now);
}

/**
 * Makes a chat's touches a person's, once Care save or link the chat or the number books: and the visitor any of them
 * named by its reference, with that visitor's own touches.
 */
export async function claimChat(db: D1Database, mobileE164: string, personId: string, now: Date): Promise<void> {
  const { results } = await db
    .prepare(
      `UPDATE touches SET person_id = ?2, mobile_e164 = NULL WHERE person_id IS NULL AND mobile_e164 = ?1
       RETURNING visitor_id`,
    )
    .bind(mobileE164, personId)
    .all<{ visitor_id: string | null }>();
  const visitors = new Set(results.flatMap((row) => (row.visitor_id === null ? [] : [row.visitor_id])));
  for (const visitorId of visitors) await claimVisitor(db, visitorId, personId, now);
  if (results.length > 0 && visitors.size === 0) await refreshAttribution(db, personId, now);
}
