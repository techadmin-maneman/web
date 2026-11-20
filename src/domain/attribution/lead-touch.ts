// The touch a lead from the site is made by (docs/decisions/0288-attribution-and-conversions.md): what the page sent
// with it, the visitor its cookie names, and the address and browser it came from. The visitor's earlier touches become
// the person's with it. Nothing here may fail the form: a lead left without its touch is given one by the cron
// (./backfill.ts).

import type { Logger } from "../../log.ts";
import { withAttribution } from "./attribution.ts";
import {
  claimStatements,
  NOTHING_CARRIED,
  numberClaimStatements,
  resolveCodes,
  touchStatement,
  type Carried,
} from "./touches.ts";

/** What a page sends of where its visitor came from (src/routes/schemas/attribution.ts): each field optional. */
export type PageTouch = Readonly<Partial<Record<keyof Carried | "ref" | "soc" | "offer", string | undefined>>> & {
  readonly ad_consent?: "granted" | "denied" | undefined;
};

/** What the request says of its visitor. */
export interface VisitContext {
  readonly visitorId: string | null;
  readonly userAgent: string | null;
  readonly clientIp: string | null;
}

const given = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** The codes a page sent: a friend's or a partner's, a society's, an offer link's. */
export const codesOf = (page: PageTouch) => ({ ref: given(page.ref), soc: given(page.soc), offer: given(page.offer) });

/** What a page sent, as a touch carries it. */
export function carriedOf(body: PageTouch): Carried {
  return Object.fromEntries(
    Object.keys(NOTHING_CARRIED).map((key) => [key, given(body[key as keyof PageTouch])]),
  ) as unknown as Carried;
}

/** What a form says of its visitor's touch: whose it is, and the lead it made, where it made one. */
interface FormTouch {
  /** Null for a number already followed up, which writes no lead but whose touch is still theirs. */
  readonly leadId: string | null;
  readonly personId: string;
  readonly visit: VisitContext;
  readonly attribution: PageTouch;
  /** The version of the notice on Google and Meta the form showed, where it showed one. */
  readonly adNotice?: string | null;
  readonly now: Date;
}

/**
 * Records the form's touch, makes the visitor's touches the person's, and points the lead at its touch where there is
 * one. A number we hold keeps its first touch: a new one is only ever added.
 */
export async function touchForLead(db: D1Database, lead: FormTouch, log: Logger): Promise<void> {
  try {
    const { attribution, visit } = lead;
    const resolved = await resolveCodes(db, codesOf(attribution));
    const { statement, recorded } = touchStatement(db, {
      at: lead.now,
      via: "site",
      visitorId: visit.visitorId,
      personId: lead.personId,
      mobileE164: null,
      carried: carriedOf(attribution),
      resolved,
      declared: null,
      adConsent: attribution.ad_consent ?? null,
      adNotice: lead.adNotice ?? null,
      userAgent: visit.userAgent,
      clientIp: visit.clientIp,
    });
    await withAttribution(
      db,
      lead.personId,
      [
        statement,
        ...(visit.visitorId === null ? [] : claimStatements(db, visit.visitorId, lead.personId)),
        ...numberClaimStatements(db, lead.personId),
        ...(lead.leadId === null
          ? []
          : [db.prepare("UPDATE leads SET touch_id = ?2 WHERE id = ?1").bind(lead.leadId, recorded.id)]),
      ],
      lead.now,
    );
  } catch (error) {
    log.warn("lead_touch_failed", { lead_id: lead.leadId, reason: error instanceof Error ? error.name : "unknown" });
  }
}
