// Where a visitor came from, as a page view shows it: the campaign tags, the
// referring site and the landing path. Never a query string, which could hold
// anything. site/src/lib/visit.ts keeps it for the visit.

import type { Attribution } from "./api.ts";

const TAGS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "gclid", "fbclid"] as const;
const MAX = { tag: 200, referrer: 500, path: 500 };

/** What this page view says about where the visit came from. */
export function attributionFrom(url: URL, referrer: string): Attribution {
  const found: Attribution = { landing_path: url.pathname.slice(0, MAX.path) };
  for (const tag of TAGS) {
    const value = url.searchParams.get(tag);
    if (value !== null && value !== "") found[tag] = value.slice(0, MAX.tag);
  }
  // Only another site counts as a referrer; the path alone, with no query.
  if (referrer !== "") {
    const from = new URL(referrer);
    if (from.origin !== url.origin) found.referrer = `${from.origin}${from.pathname}`.slice(0, MAX.referrer);
  }
  return found;
}
