// The site's switches.

/**
 * Whether the site gives prices. They are off every page (ADR 0103): the prices
 * section, the invite's price list and the price range search engines read wait on this. While off, the Worker asks for no price book, and / is left to the assets (run_worker_first in
 * site/wrangler.jsonc, which test/node/site/site-prices.test.ts keeps in step).
 */
export const PRICES_SHOWN = false as boolean;

/**
 * Whether the site asks for consent to its ad and measurement tags (site/src/components/ConsentBar.astro). Off until
 * counsel approves its words; while off, no visitor can agree, so Google's tags stay denied and the Meta Pixel unloaded.
 */
export const CONSENT_BAR_SHOWN = false as boolean;
