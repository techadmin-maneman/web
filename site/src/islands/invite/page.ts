// What the landing reads from its own page: the code in the address, and what the mm-site Worker wrote in before
// any JavaScript ran (site/src/worker.ts), the invite on #invite and the price book's figures on <body>.

import type { Invite } from "../../lib/api.ts";
import { isInvite } from "../../lib/invite.ts";
import { isPublishedPrices, priceWords, standardOf, type PriceWords } from "../../lib/prices.ts";

/**
 * The code in the address: /r/ABC123. Empty where the page is opened without one, and while
 * the page is built: Astro renders the island once on the server, where there is no address.
 */
export function codeInPath(): string {
  if (typeof location === "undefined") return "";
  return /^\/r\/([A-Za-z0-9]{4,12})\/?$/.exec(location.pathname)?.[1]?.toUpperCase() ?? "";
}

/** The invite the Worker wrote into the page, if it did and it reads as one. */
export function inviteInPage(): Invite | null {
  const written = document.getElementById("invite")?.dataset.invite;
  if (written === undefined || written === "") return null;
  try {
    const parsed: unknown = JSON.parse(written);
    return isInvite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The price book's figures the Worker wrote onto the page, as words, if it did and they read as its answer. Null
 * where it did not, and while the page is built, which draws the build's own figures.
 */
export function pricesInPage(): PriceWords | null {
  if (typeof document === "undefined") return null;
  const written = document.body.dataset.prices;
  if (written === undefined || written === "") return null;
  try {
    const parsed: unknown = JSON.parse(written);
    return isPublishedPrices(parsed) ? priceWords(standardOf(parsed)) : null;
  } catch {
    return null;
  }
}
