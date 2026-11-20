// A WhatsApp chat as a touch (docs/decisions/0288-attribution-and-conversions.md). A message that ends with a site
// visitor's reference ("Ref M7K2Q9XP") ties the chat to that visitor's touches; one that opens a chat from a
// click-to-WhatsApp ad carries the ad's click ID, ad and post. Either is a touch on the chat's number at once: the
// person's where we know the number, else kept by the number until Care save or link the chat, or the number books.
// Nobody is made from a message alone (docs/decisions/0138-strangers-in-the-inbox.md).

import { refIn } from "../../config/ref-tokens.ts";
import { claimChat, claimVisitor, NOTHING_CARRIED, NO_CODES, recordTouch, resolveCodes } from "./touches.ts";
import { visitorOfRef } from "./visitors.ts";

/** What a click-to-WhatsApp ad's first message says of the ad. */
export interface AdReferral {
  readonly ctwaClid: string | null;
  readonly sourceId: string | null;
  readonly sourceUrl: string | null;
}

/** The person who holds the number, where one does and is not erased. */
async function holderOf(db: D1Database, mobileE164: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL")
    .bind(mobileE164)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Records the message's touch where it carries a reference or an ad's referral; nothing for any other message. */
export async function touchFromChat(
  db: D1Database,
  message: {
    readonly mobileE164: string;
    readonly text: string;
    readonly referral: AdReferral | null;
    readonly now: Date;
  },
): Promise<void> {
  const ref = refIn(message.text);
  const visitorId = ref === null ? null : await visitorOfRef(db, ref);
  const { referral } = message;
  if (visitorId === null && referral === null) return;
  const personId = await holderOf(db, message.mobileE164);
  if (personId !== null && visitorId !== null) await claimVisitor(db, visitorId, personId, message.now);
  await recordTouch(db, {
    at: message.now,
    via: "whatsapp",
    visitorId,
    personId,
    mobileE164: message.mobileE164,
    carried: {
      ...NOTHING_CARRIED,
      ctwa_clid: referral?.ctwaClid ?? null,
      ad_source_id: referral?.sourceId ?? null,
      ad_source_url: referral?.sourceUrl ?? null,
    },
    resolved: await resolveCodes(db, NO_CODES),
    declared: null,
    adConsent: null,
    userAgent: null,
    clientIp: null,
  });
}

/**
 * The touch a lead Care saved from a chat is made by: the chat's own touches, and any visitor they named, made the
 * person's; and a touch for the lead itself, its channel WhatsApp where nothing else told.
 */
export async function touchForChatLead(
  db: D1Database,
  lead: { readonly leadId: string; readonly personId: string; readonly mobileE164: string; readonly now: Date },
): Promise<void> {
  await claimChat(db, lead.mobileE164, lead.personId, lead.now);
  const touch = await recordTouch(db, {
    at: lead.now,
    via: "whatsapp",
    visitorId: null,
    personId: lead.personId,
    mobileE164: null,
    carried: NOTHING_CARRIED,
    resolved: await resolveCodes(db, NO_CODES),
    declared: null,
    adConsent: null,
    userAgent: null,
    clientIp: null,
  });
  await db.prepare("UPDATE leads SET touch_id = ?2 WHERE id = ?1").bind(lead.leadId, touch.id).run();
}
