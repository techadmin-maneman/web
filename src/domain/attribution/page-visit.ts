// A page's report of its visitor's landing (docs/decisions/0288-attribution-and-conversions.md): their first, and any
// later one a campaign put something in, is a touch. A plain visit later records nothing, so a visitor who comes back
// by typing the address never takes the last touch from the campaign that brought them; a landing sent again, by its
// own key, records nothing more. A browser that declined the cookie bar keeps its touches declined, in whatever order
// the two reach the API (./touches.ts).

import { carriesCampaign } from "../../policy/channels.ts";
import { carriedOf, codesOf, type PageTouch } from "./lead-touch.ts";
import { recordTouch, resolveCodes } from "./touches.ts";
import { declinedVisitorStatement, seeVisitor } from "./visitors.ts";

/**
 * A Decline on the cookie bar, from the visitor's own browser: every touch it made keeps none of Meta's cookies, its
 * address or its browser, and is marked declined, so what came before the Decline is never sent either; and the
 * browser is marked, so a landing reported before the Decline that reaches the API after it is declined as well.
 */
export async function declineVisitor(db: D1Database, visitorId: string, now: Date): Promise<void> {
  await db.batch([
    declinedVisitorStatement(db, visitorId, now),
    db
      .prepare(
        `UPDATE touches SET fbc = NULL, fbp = NULL, client_ip = NULL, user_agent = NULL, ad_consent = 'denied'
         WHERE visitor_id = ?1`,
      )
      .bind(visitorId),
  ]);
}

/** Records the landing as a touch where it is the visitor's first or a campaign's; the visitor's reference either way. */
export async function recordVisit(
  db: D1Database,
  visit: {
    readonly visitorId: string;
    readonly page: PageTouch;
    /** The page's own mark for this landing, where it sent one. */
    readonly landingKey: string | null;
    readonly now: Date;
  },
): Promise<{ readonly ref: string }> {
  const { ref, personId } = await seeVisitor(db, visit.visitorId, visit.now);
  const carried = carriedOf(visit.page);
  const resolved = await resolveCodes(db, codesOf(visit.page));
  const campaign =
    resolved.linkId !== null ||
    carriesCampaign({
      utmSource: carried.utm_source,
      utmMedium: carried.utm_medium,
      utmCampaign: carried.utm_campaign,
      gclid: carried.gclid,
      gbraid: carried.gbraid,
      wbraid: carried.wbraid,
      fbclid: carried.fbclid,
      ctwaClid: null,
      referrer: carried.referrer,
      code: resolved.codeKind,
      declared: null,
      via: "site",
    });
  const touched = await db.prepare("SELECT 1 FROM touches WHERE visitor_id = ?1 LIMIT 1").bind(visit.visitorId).first();
  if (touched !== null && !campaign) return { ref };
  await recordTouch(db, {
    at: visit.now,
    via: "site",
    visitorId: visit.visitorId,
    personId,
    mobileE164: null,
    carried,
    resolved,
    declared: null,
    adConsent: visit.page.ad_consent ?? null,
    landingKey: visit.landingKey,
    // A page's touch keeps no address or browser: only a lead's is sent to Meta.
    userAgent: null,
    clientIp: null,
  });
  return { ref };
}
