// The site's switches.

/**
 * Whether the site asks for consent to its ad and measurement tags (site/src/components/ConsentBar.astro). Off until
 * counsel approves its words; while off, no visitor can agree, so Google's tags stay denied and the Meta Pixel unloaded.
 */
export const CONSENT_BAR_SHOWN = false as boolean;
