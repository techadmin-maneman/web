// Where this visitor came from (docs/decisions/0288-attribution-and-conversions.md), kept in this browser for as long
// as the site's visitor cookie lasts: their first landing, and their latest that a campaign put something in, which a
// plain visit later never replaces. Each such landing is reported to the API, which keeps it as the visitor's touch
// and answers the reference their WhatsApp message ends with: once the page has loaded, so no report holds up its
// first paint, or as the page goes where the visitor leaves first. A friend's or a partner's code in ?ref is
// remembered as the invite /book carries (./remembered-invite.ts). Storage a browser refuses keeps nothing, and every page works
// without it.

import { CODE_PATTERN } from "@rules/config/invite-codes.ts";
import { REF_PATTERN } from "@rules/config/ref-tokens.ts";
import { consentAnswer } from "./analytics.ts";
import { reportDecline, reportVisit, type Attribution } from "./api.ts";
import { attributionFrom, carriesCampaign } from "./attribution.ts";
import { rememberInvite } from "./remembered-invite.ts";

const FIRST = "mm_first_touch";
const LAST = "mm_last_touch";
const REF = "mm_ref";
/** A Decline on the cookie bar the API has not yet heard of. */
const DECLINE_UNSENT = "mm_decline_unsent";

/** The longest the reports wait for the page's load, which a slow ad tag can hold up. */
const LOAD_WAIT_MS = 3000;

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

function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing was kept to forget.
  }
}

function declineUnsent(): boolean {
  try {
    return localStorage.getItem(DECLINE_UNSENT) !== null;
  } catch {
    return false;
  }
}

/**
 * Tells the API the visitor declined the cookie bar, so nothing their browser's touches kept for Meta is sent, nor
 * anything a landing reported later keeps: at once, outliving the page. Kept in the browser until the API has heard
 * it, and sent again from the next page: a Decline lost offline is never lost.
 */
export async function reportDeclined(): Promise<void> {
  keep(DECLINE_UNSENT, "1");
  const going = [...reporting];
  const answer = await reportDecline();
  // A landing report going as the visitor declined can reach the API after the Decline: it goes again once they have.
  const again = going.length === 0 ? answer : (await Promise.all(going), await reportDecline());
  if (answer.ok && again.ok) forget(DECLINE_UNSENT);
}

/** The landing reports going now: a Decline is sent again once they have answered. */
const reporting = new Set<Promise<unknown>>();

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

/**
 * Reports a landing to the API, outliving the page where it is `leaving`, and keeps its reference; whether the API kept
 * the touch. Only a page's last word is kept alive: a request so sent counts against the page's first paint.
 */
async function report(landed: Kept, leaving = false): Promise<boolean> {
  const sending = reportVisit({ ...withConsent(landed.touch), landing_key: landed.at }, leaving);
  reporting.add(sending);
  const answer = await sending;
  reporting.delete(sending);
  if (answer.ok && answer.body.ref !== null) keep(REF, answer.body.ref);
  return answer.ok && answer.body.ref !== null;
}

/**
 * Runs on every page, before the analytics tags tidy the address: keeps this landing as the first or the last touch
 * where it is one, and reports it after the page has loaded, and as it goes what was not yet answered. While no reference is kept, the
 * first report never arrived or the API kept nothing, so the first landing goes again before anything else, which
 * keeps the visitor's first touch their first on the API too. A Decline an earlier page could not send goes at once.
 * `stop` lets a test take its listeners away.
 */
export function captureAttribution(stop?: AbortSignal): void {
  const touch = attributionFrom(new URL(location.href), document.referrer, document.cookie);
  if (touch.ref !== undefined && CODE_PATTERN.test(touch.ref)) rememberInvite(touch.ref);
  const landed: Kept = { touch, at: new Date().toISOString() };
  const keptFirst = kept(FIRST);
  const campaign = carriesCampaign(touch);
  if (keptFirst === null) keep(FIRST, JSON.stringify(landed));
  if (keptFirst === null || campaign) keep(LAST, JSON.stringify(landed));
  if (declineUnsent()) void reportDeclined();
  const due = [
    ...(keptFirst !== null && visitorRef() === null ? [keptFirst] : []),
    ...(keptFirst === null || campaign ? [landed] : []),
  ];
  if (due.length === 0) return;
  let started = false;
  /** How many of what is due the API has kept, oldest first. */
  let done = 0;
  afterLoad(() => {
    if (started || stop?.aborted === true) return;
    started = true;
    // Oldest first, each once the one before was kept.
    void (async () => {
      for (const each of due) {
        if (!(await report(each))) return;
        done += 1;
      }
    })();
  }, stop);
  addEventListener(
    "pagehide",
    () => {
      started = true;
      // What the API has not answered yet goes as the page does; one it had already is kept once.
      for (const each of due.slice(done)) void report(each, true);
    },
    once(stop),
  );
}

/** A listener heard once, and taken away early where `stop` says. */
const once = (stop?: AbortSignal): AddEventListenerOptions =>
  stop === undefined ? { once: true } : { once: true, signal: stop };

/**
 * Runs once the page has loaded, or after LOAD_WAIT_MS where an ad tag holds its load up, and then when the browser is
 * free, three seconds later at most: so a report never holds up the page's first paint. A shorter wait than three
 * seconds put the invite landing's first paint back over Lighthouse's budget.
 */
function afterLoad(run: () => void, stop?: AbortSignal): void {
  let started = false;
  const start = () => {
    if (started || stop?.aborted === true) return;
    started = true;
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 0);
  };
  if (document.readyState === "complete") {
    start();
    return;
  }
  addEventListener("load", start, once(stop));
  const wait = setTimeout(start, LOAD_WAIT_MS);
  stop?.addEventListener("abort", () => {
    clearTimeout(wait);
  });
}

/** Where this visit came from, as a form sends it: the latest campaign's landing, else the first. */
export function readAttribution(): Attribution | undefined {
  const touch = (kept(LAST) ?? kept(FIRST))?.touch;
  return touch === undefined ? undefined : withConsent(touch);
}
