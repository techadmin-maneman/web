// What attribution keeps up each hour (docs/decisions/0288-attribution-and-conversions.md): a lead from before touches
// is given one, from what it was saved with, in batches the hour's run can carry, and its client's attribution with
// it: the first touch, where one recorded since came later, and the channels of what they did before, since their
// history is only now known. What Care's old "How they found us" said becomes the client's answer to how they heard
// of us. And what the
// retention periods let go of: a touch's address and browser 90 days on, and a visitor no number ever named, with their
// touches, 13 months after their last.

import { DAY_MS } from "../../lib/durations.ts";
import {
  monthsBefore,
  STRANGER_CHAT_MONTHS,
  TOUCH_ADDRESS_DAYS,
  UNNAMED_VISITOR_DAYS,
} from "../../policy/retention.ts";
import { withAttribution } from "./attribution.ts";
import { NOTHING_CARRIED, NO_CODES, resolveCodes, touchStatement } from "./touches.ts";

/** How many old leads one run gives a touch. */
const BATCH = 100;

/** What Care's "How they found us", a channel code, says as an answer to how they heard of us. */
const HEARD_OF_FOUND: Readonly<Record<string, string>> = {
  google_ads: "google",
  organic_search: "google",
  meta_ads: "instagram_facebook",
  organic_social: "instagram_facebook",
  referral: "friend",
  partner: "salon_partner",
};

interface OldLead {
  readonly id: string;
  readonly person_id: string;
  readonly created_at: string;
  readonly source: string | null;
  readonly utm_source: string | null;
  readonly utm_medium: string | null;
  readonly utm_campaign: string | null;
  readonly utm_content: string | null;
  readonly gclid: string | null;
  readonly fbclid: string | null;
  readonly referrer: string | null;
  readonly landing_path: string | null;
  readonly found_us: string | null;
}

/** Gives the oldest leads with no touch one each; how many it gave. */
export async function touchOldLeads(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id, person_id, created_at, source, utm_source, utm_medium, utm_campaign, utm_content, gclid, fbclid,
         referrer, landing_path, found_us
       FROM leads WHERE touch_id IS NULL ORDER BY created_at LIMIT ?1`,
    )
    .bind(BATCH)
    .all<OldLead>();
  const resolved = await resolveCodes(db, NO_CODES);
  for (const lead of results) {
    const at = new Date(lead.created_at);
    const { statement, recorded } = touchStatement(db, {
      at,
      via: lead.source === "whatsapp" ? "whatsapp" : "site",
      visitorId: null,
      personId: lead.person_id,
      mobileE164: null,
      carried: { ...NOTHING_CARRIED, ...lead, utm_term: null },
      resolved,
      declared: null,
      adConsent: null,
      userAgent: null,
      clientIp: null,
    });
    await withAttribution(
      db,
      lead.person_id,
      [
        statement,
        // A touch recorded since touches began came after this lead: the lead's own, from before, is the first.
        db
          .prepare(
            `UPDATE person_attribution SET first_touch_id = NULL
             WHERE person_id = ?1 AND (SELECT at FROM touches WHERE id = first_touch_id) > ?2`,
          )
          .bind(lead.person_id, lead.created_at),
        db.prepare("UPDATE leads SET touch_id = ?2 WHERE id = ?1").bind(lead.id, recorded.id),
      ],
      at,
    );
    const heard = lead.found_us === null ? undefined : HEARD_OF_FOUND[lead.found_us];
    await db.batch([
      db
        .prepare(
          `UPDATE person_attribution SET heard_from = ?2, heard_from_by = 'care', heard_from_at = ?3
           WHERE person_id = ?1 AND heard_from IS NULL AND ?2 IS NOT NULL`,
        )
        .bind(lead.person_id, heard ?? null, lead.created_at),
      // What they did before their history was known takes their channel as it now stands, and, each, the last touch
      // a campaign put something in by then, else their first.
      db
        .prepare(
          `UPDATE conversions SET
             attributed_channel = COALESCE((SELECT attributed_channel FROM person_attribution WHERE person_id = ?1),
               attributed_channel),
             last_touch_channel = COALESCE(
               (SELECT t.channel FROM touches t WHERE t.person_id = ?1 AND t.campaign_signal = 1
                  AND t.at <= conversions.occurred_at ORDER BY t.at DESC, t.rowid DESC LIMIT 1),
               (SELECT t.channel FROM person_attribution pa JOIN touches t ON t.id = pa.first_touch_id
                  WHERE pa.person_id = ?1),
               last_touch_channel)
           WHERE person_id = ?1`,
        )
        .bind(lead.person_id),
    ]);
  }
  return results.length;
}

/** Lets go of what the retention periods allow: touches' addresses and browsers, and visitors never named. */
export async function letAttributionGo(db: D1Database, now: Date): Promise<void> {
  const addressesBefore = new Date(now.getTime() - TOUCH_ADDRESS_DAYS * DAY_MS).toISOString();
  const unnamedBefore = new Date(now.getTime() - UNNAMED_VISITOR_DAYS * DAY_MS).toISOString();
  const strangersBefore = monthsBefore(now, STRANGER_CHAT_MONTHS);
  const unnamed = "SELECT id FROM visitors WHERE person_id IS NULL AND seen_at < ?1";
  // On its own, so nothing else here can hold it up.
  await db
    .prepare(
      `UPDATE touches SET client_ip = NULL, user_agent = NULL
       WHERE at < ?1 AND (client_ip IS NOT NULL OR user_agent IS NOT NULL)`,
    )
    .bind(addressesBefore)
    .run();
  await db.batch([
    db.prepare(`DELETE FROM touches WHERE person_id IS NULL AND visitor_id IN (${unnamed})`).bind(unnamedBefore),
    // A client's touch from a browser that another's erasure left unnamed stays theirs, without the browser.
    db.prepare(`UPDATE touches SET visitor_id = NULL WHERE visitor_id IN (${unnamed})`).bind(unnamedBefore),
    db.prepare(`DELETE FROM visitors WHERE id IN (${unnamed})`).bind(unnamedBefore),
    // A chat's touch from a number no one we know holds goes when the chat itself would.
    db
      .prepare("DELETE FROM touches WHERE person_id IS NULL AND mobile_e164 IS NOT NULL AND at < ?1")
      .bind(strangersBefore),
  ]);
}
