// Every string and image on the site, taken word for word from the design
// (design/Mane Man Site v2.dc.html), except where the home page was rewritten
// (docs/decisions/0103-the-home-pages-first-copy-round.md).
// Components hold no copy of their own.
//
// Some entries need care before production (docs/frontend.md):
//
// - Placeholder blocks carry `publish`. They hold the design's placeholder
//   material and render in staging with the design's "Placeholder" tag. In
//   production only published blocks render, and the build stops if a
//   published block still holds the design's material (design-placeholders.ts).
// - Notices carry the version recorded with a consent, and `approved`. The
//   wording itself is the backend's (src/config/notices.ts), so the page and
//   the consent record can never disagree. The production build stops while
//   any notice is unapproved, and a new version is unapproved until it is
//   added to APPROVED_NOTICES.
// - The legal pages carry `approved` too: the production build stops until
//   counsel has signed their wording off.
// - Prices are holes, "{firstFit}, then {service} a month", which the price
//   book fills (src/lib/prices.ts, docs/decisions/0073-prices-from-the-price-book.md).
//   The production build stops on a price typed into a sentence.
//
// Images are file names in design/assets; src/lib/images.ts resolves them.
// `{city}` and similar are filled in by the page.

export * from "./site/media.ts";
export * from "./site/notices.ts";
export * from "./site/contact.ts";
export * from "./site/legal.ts";
export * from "./site/home.ts";
export * from "./site/tryon.ts";
export * from "./site/pages.ts";
