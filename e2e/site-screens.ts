// The site's built pages, and each screen of its flows that opens as a ?state= preview, for the tests that hold every
// one of them to the redesign's look (./site-look.e2e.ts) and sizes (./site-sizes.e2e.ts).

import * as siteCopy from "../site/src/content/site.ts";

/** The pages whose islands wait to be scrolled to, the try-on teaser's slider among them: opened, never visited. */
export const SCROLLED_TO = ["/", "/gurgaon"];

export const PAGES = [
  "/",
  "/gurgaon",
  "/try",
  "/book",
  "/privacy",
  siteCopy.NOTICES_PATH,
  "/terms",
  "/aftercare",
  "/offer-terms",
  "/stop",
  "/pay",
  "/pay-again",
  "/guides",
  "/guides/what-is-a-hair-system",
  "/areas",
  "/r/RM4K7P",
  "/no-such-page",
];

/**
 * Every page, /stop as a link opens it, and each screen of the flows that opens as a ?state= preview
 * (site/src/islands/invite/preview.ts, site/src/islands/tryon/machine.ts). /book's area and address steps have none,
 * and are reached by the booking's own tests.
 */
export const SCREENS = [
  ...PAGES,
  "/stop#a-token",
  "/areas/gurgaon",
  "/book?state=served",
  "/book?state=unserved",
  "/book?state=booked",
  "/book?state=requested",
  "/book?state=expired",
  "/book?state=listed",
  "/try?state=looks",
  "/try?state=gate",
  "/try?state=sent",
  "/try?state=sent&kind=returning",
  "/try?state=error",
  "/try?state=error&kind=unavailable",
];
