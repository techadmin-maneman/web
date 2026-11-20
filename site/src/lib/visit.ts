// Where this visitor came from (docs/decisions/0288-attribution-and-conversions.md), kept in this browser for as long
// as the site's visitor cookie lasts: their first landing, and their latest that a campaign put something in, which a
// plain visit later never replaces. Each such landing is reported to the API, which keeps it as the visitor's touch
// and answers the reference their WhatsApp message ends with. A friend's or a partner's code in ?ref is remembered as
// the invite /book carries (./remembered-invite.ts). Storage a browser refuses keeps nothing, and every page works
// without it.

import { CODE_PATTERN } from "@rules/config/invite-codes.ts";
import { REF_PATTERN } from "@rules/config/ref-tokens.ts";
import { consentAnswer } from "./analytics.ts";
import { reportVisit, type Attribution } from "./api.ts";
import { attributionFrom, carriesCampaign } from "./attribution.ts";
import { rememberInvite } from "./remembered-invite.ts";

const FIRST = "mm_first_touch";
const LAST = "mm_last_touch";
const REF = "mm_ref";

/** 13 months, as the visitor cookie lasts. */
const KEPT_MS = 396 * 86_400_000;

interface Kept {
  readonly touch: Attribution;
  readonly at: string;
}

function kept(key: string): Kept | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (typeof stored !== "object" || stored === null || !("touch" in stored) || !("at" in stored)) return null;
    const { at } = stored as { at: unknown };
    if (typeof at !== "string" || Date.now() - Date.parse(at) > KEPT_MS) return null;
    return stored as Kept;
  } catch {
    return null;
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept nowhere: the API's own record of the touch stands.
  }
}

/** The reference this visitor's WhatsApp message ends with, once the API has given one. */
export function visitorRef(): string | null {
  try {
    const ref = localStorage.getItem(REF);
    return ref !== null && REF_PATTERN.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

/** The visitor's answer to the cookie bar, as the API is told it: none while they have not answered. */
const withConsent = (touch: Attribution): Attribution => {
  const answer = consentAnswer();
  return answer === null ? touch : { ...touch, ad_consent: answer };
};

/** Reports a landing to the API, and keeps the reference it answers with. */
async function report(touch: Attribution): Promise<void> {
  const answer = await reportVisit(withConsent(touch));
  if (answer.ok && answer.body.ref !== null) keep(REF, answer.body.ref);
}

/**
 * Runs on every page, before the analytics tags tidy the address: keeps this landing as the first or the last touch
 * where it is one, and reports it. While no reference is kept, the first report never arrived, so the first landing
 * is reported again before anything else, which keeps the visitor's first touch their first on the API too.
 */
export function captureAttribution(): void {
  const touch = attributionFrom(new URL(location.href), document.referrer, document.cookie);
  if (touch.ref !== undefined && CODE_PATTERN.test(touch.ref)) rememberInvite(touch.ref);
  const now = JSON.stringify({ touch, at: new Date().toISOString() } satisfies Kept);
  const keptFirst = kept(FIRST);
  const campaign = carriesCampaign(touch);
  if (keptFirst === null) keep(FIRST, now);
  if (keptFirst === null || campaign) keep(LAST, now);
  const unreported = keptFirst !== null && visitorRef() === null ? keptFirst.touch : null;
  void (async () => {
    if (unreported !== null) await report(unreported);
    if (keptFirst === null || campaign) await report(touch);
  })();
}

/** Where this visit came from, as a form sends it: the latest campaign's landing, else the first. */
export function readAttribution(): Attribution | undefined {
  const touch = (kept(LAST) ?? kept(FIRST))?.touch;
  return touch === undefined ? undefined : withConsent(touch);
}
