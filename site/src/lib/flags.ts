// The site's switches.

/**
 * Whether the site asks for consent to its ad and measurement tags (site/src/components/ConsentBar.astro), with the
 * footers' Cookie choices. Consent starts granted (ADR 0288), so while off every visitor's tags run and none can
 * decline: switching it off needs the privacy policy's section 7 changed with it.
 */
export const CONSENT_BAR_SHOWN = true as boolean;

/**
 * Whether maneman.in serves the site. Until it does, a production build is the coming-soon page
 * (scripts/build/coming-soon.ts), never indexed; switched on, it is the site, which the publish gate must pass first.
 * The smoke check reads it to know which production should be serving (scripts/lib/smoke.ts).
 */
export const PRODUCTION_LIVE = true as boolean;
