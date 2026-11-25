// What a landing says of where the visitor came from (docs/decisions/0288-attribution-and-conversions.md): the
// campaign's tags, Google's and Meta's click IDs, Meta's cookies where the Pixel set them, any code of ours, the page
// before and the page landed on. Never a query string, which could hold anything. site/src/lib/visit.ts keeps it.

import type { Attribution } from "./api.ts";

const TAGS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
] as const;

/** Codes of ours a link may carry: a friend's or a partner's invite, a society's, an offer's. */
const CODES = ["ref", "soc", "offer"] as const;

/** What a landing carries that a campaign put there: only such a landing is a new last touch. */
const CAMPAIGN = [...TAGS, ...CODES] as const;

const MAX = { tag: 200, clickId: 500, code: 20, referrer: 500, path: 500 };

/** A cookie's value, or undefined. */
function cookie(cookies: string, name: string): string | undefined {
  for (const pair of cookies.split(";")) {
    const [key, value] = pair.trim().split("=");
    if (key === name && value !== undefined && value !== "") return decodeURIComponent(value);
  }
  return undefined;
}

/** What this page view says about where the visit came from, and Meta's cookies as the browser holds them. */
export function attributionFrom(url: URL, referrer: string, cookies: string): Attribution {
  // A payment link's address is kept as /pay alone: its token is the client's
  // (docs/decisions/0300-payment-links-on-whatsapp.md).
  const path = url.pathname.startsWith("/pay/") ? "/pay" : url.pathname;
  const found: Attribution = { landing_path: path.slice(0, MAX.path) };
  for (const tag of TAGS) {
    const value = url.searchParams.get(tag);
    const longest = tag.startsWith("utm_") ? MAX.tag : MAX.clickId;
    if (value !== null && value !== "") found[tag] = value.slice(0, longest);
  }
  for (const code of CODES) {
    const value = url.searchParams.get(code);
    if (value !== null && /^[A-Za-z0-9]{3,16}$/.test(value)) found[code] = value.slice(0, MAX.code);
  }
  // A society's code as a link to the try-on may carry it, /try?s=<code>, where its own link carries none.
  const society = url.searchParams.get("s");
  if (found.soc === undefined && society !== null && /^[A-Za-z0-9]{3,16}$/.test(society)) {
    found.soc = society.slice(0, MAX.code);
  }
  const fbp = cookie(cookies, "_fbp");
  const fbc = cookie(cookies, "_fbc");
  if (fbp !== undefined) found.fbp = fbp.slice(0, MAX.clickId);
  if (fbc !== undefined) found.fbc = fbc.slice(0, MAX.clickId);
  // Only another site counts as a referrer; the path alone, with no query.
  if (referrer !== "") {
    const from = new URL(referrer);
    if (from.origin !== url.origin) found.referrer = `${from.origin}${from.pathname}`.slice(0, MAX.referrer);
  }
  return found;
}

/** Whether a landing carries anything a campaign put there. */
export const carriesCampaign = (touch: Attribution): boolean => CAMPAIGN.some((key) => touch[key] !== undefined);
