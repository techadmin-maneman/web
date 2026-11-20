// Where this visitor came from (docs/decisions/0288-attribution-and-conversions.md), kept in this browser for as long
// as the site's visitor cookie lasts: their first landing, and their latest that a campaign put something in, which a
// plain visit later never replaces. Each such landing is reported to the API, which keeps it as the visitor's touch
// and answers the reference their WhatsApp message ends with: once the page has loaded, so no report holds up its
// first paint; kept as unsent until the API has it, sent as the page goes if the visitor leaves first, and again from
// the next page if it was lost. A friend's or a partner's code in ?ref is remembered as
// the invite /book carries (./remembered-invite.ts). Storage a browser refuses keeps nothing, and every page works
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

/** Landings the API has not yet had, oldest first. */
const UNSENT = "mm_landings_unsent";
/** At most so many wait unsent: a browser offline for long keeps its latest. */
const UNSENT_MAX = 5;
/** The longest the reports wait for the page's load, which a slow ad tag can hold up. */
const LOAD_WAIT_MS = 3000;

/** 13 months, as the visitor cookie lasts. */
const KEPT_MS = 396 * 86_400_000;

interface Kept {
  readonly touch: Attribution;
  readonly at: string;
}

function isKept(stored: unknown): stored is Kept {
  if (typeof stored !== "object" || stored === null || !("touch" in stored) || !("at" in stored)) return false;
  const { at } = stored as { at: unknown };
  return typeof at === "string" && Date.now() - Date.parse(at) <= KEPT_MS;
}

function kept(key: string): Kept | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return isKept(stored) ? stored : null;
  } catch {
    return null;
  }
}

function unsent(): Kept[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(UNSENT) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isKept) : [];
  } catch {
    return [];
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept nowhere: the API's own record of the touch stands.
  }
}

const keepUnsent = (list: readonly Kept[]): void => {
  keep(UNSENT, JSON.stringify(list.slice(-UNSENT_MAX)));
};

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

/** The landing reports going now: a Decline waits for them, so the API blanks what they keep as well. */
let reporting: Promise<void> = Promise.resolve();

/**
 * Tells the API the visitor declined the cookie bar, so nothing their browser's touches kept for Meta is sent: after
 * any landing report going now, so that one is blanked too. Kept in the browser until the API has heard it, and sent
 * again first from the next page: a Decline lost offline is never lost.
 */
export async function reportDeclined(): Promise<void> {
  keep(DECLINE_UNSENT, "1");
  await reporting;
  const answer = await reportDecline();
  if (answer.ok) forget(DECLINE_UNSENT);
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

/** Reports a landing to the API and keeps the reference it answers with; whether the API had it. */
async function report(touch: Attribution, keepalive = false): Promise<boolean> {
  const answer = await reportVisit(withConsent(touch), keepalive);
  if (answer.ok && answer.body.ref !== null) keep(REF, answer.body.ref);
  return answer.ok;
}

/** Reports each landing kept unsent, oldest first, letting go of each once the API has it. */
async function reportUnsent(): Promise<void> {
  for (const each of unsent()) {
    if (await report(each.touch)) keepUnsent(unsent().filter((other) => other.at !== each.at));
  }
}

/**
 * Runs on every page, before the analytics tags tidy the address: keeps this landing as the first or the last touch
 * where it is one, unsent, and reports what is unsent once the page has loaded, oldest first, so the visitor's first
 * touch stays their first on the API too. A Decline an earlier page could not send goes at once, ahead of any report
 * and of a chat link's reference. What the visitor leaves before it is sent goes as the page does.
 */
export function captureAttribution(): void {
  const touch = attributionFrom(new URL(location.href), document.referrer, document.cookie);
  if (touch.ref !== undefined && CODE_PATTERN.test(touch.ref)) rememberInvite(touch.ref);
  const landed: Kept = { touch, at: new Date().toISOString() };
  const keptFirst = kept(FIRST);
  if (keptFirst === null) keep(FIRST, JSON.stringify(landed));
  if (keptFirst === null || carriesCampaign(touch)) {
    keep(LAST, JSON.stringify(landed));
    keepUnsent([...unsent(), landed]);
  }
  const declined = declineUnsent() ? reportDeclined() : Promise.resolve();
  afterLoad(() => {
    reporting = (async () => {
      await declined;
      await reportUnsent();
    })();
  });
  addEventListener(
    "pagehide",
    () => {
      for (const each of unsent()) void report(each.touch, true);
      keepUnsent([]);
    },
    { once: true },
  );
}

/**
 * Runs once the page has loaded, or after LOAD_WAIT_MS where an ad tag holds its load up, and then when the browser is
 * free, three seconds later at most: so a report never holds up the page's first paint. A shorter wait than three
 * seconds put the invite landing's first paint back over Lighthouse's budget.
 */
function afterLoad(run: () => void): void {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 0);
  };
  if (document.readyState === "complete") {
    start();
    return;
  }
  addEventListener("load", start, { once: true });
  setTimeout(start, LOAD_WAIT_MS);
}

/** Where this visit came from, as a form sends it: the latest campaign's landing, else the first. */
export function readAttribution(): Attribution | undefined {
  const touch = (kept(LAST) ?? kept(FIRST))?.touch;
  return touch === undefined ? undefined : withConsent(touch);
}
