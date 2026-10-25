// Every page of the site, which mm-site's Worker answers first for the nonce its policy is given; "/" and "/areas" also
// name the cities ops serve, and each city's page its areas, written in by the Worker (site/src/lib/cities.ts). Each
// environment of site/wrangler.jsonc lists them as assets.run_worker_first (scripts/lib/wrangler-config-check.ts).

export const SITE_WORKER_PAGES = [
  "/",
  "/aftercare",
  "/areas",
  "/areas/*",
  "/book",
  "/guides/*",
  "/privacy",
  "/notices",
  "/offer-terms",
  "/r",
  "/r/*",
  "/stop",
  "/terms",
  "/try",
  "/_astro/*.mp4",
];
