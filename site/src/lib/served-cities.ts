// The cities ops serve, as the console sets them (a city with a pincode served), which each deploy's build reads from
// its environment (scripts/lib/site-words.ts) and passes in as __MM_SERVED_CITIES__ (site/astro.config.ts): each has
// its page under /areas, its place in the sitemap and in the business's structured data
// (docs/decisions/0325-search-pages-and-opening-hours.md). A build that reads none, a local one, has the content's own
// list (business.areaServed). The site's Worker still writes in the cities served at the time of each request.

declare const __MM_SERVED_CITIES__: readonly string[];

export const SERVED_CITIES: readonly string[] = __MM_SERVED_CITIES__;
