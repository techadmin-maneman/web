// The site's switches.

/**
 * Whether the site asks for consent to its ad and measurement tags (site/src/components/ConsentBar.astro). Off until
 * counsel approves its words; while off, no visitor can agree, so Google's tags stay denied and the Meta Pixel unloaded.
 */
export const CONSENT_BAR_SHOWN = false as boolean;

/**
 * Whether maneman.in serves the site. Until it does, a production build is the coming-soon page
 * (scripts/build/coming-soon.ts), never indexed; switched on, it is the site, which the publish gate must pass first.
 * The smoke check reads it to know which production should be serving (scripts/lib/smoke.ts).
 */
export const PRODUCTION_LIVE = false as boolean;
