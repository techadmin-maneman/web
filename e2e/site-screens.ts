// The site's built pages, and each screen of its flows that opens as a ?state= preview, for the tests that hold every
// one of them to the redesign's look (./site-look.e2e.ts) and sizes (./site-sizes.e2e.ts).

import * as siteCopy from "../site/src/content/site.ts";

export const PAGES = [
  "/",
  "/try",
  "/book",
  "/privacy",
  siteCopy.NOTICES_PATH,
  "/terms",
  "/aftercare",
  "/offer-terms",
  "/stop",
  "/guides",
  "/guides/what-is-a-hair-system",
  "/areas",
  "/r/RM4K7P",
  "/no-such-page",
];

/** Every page, /stop as a link opens it, and each screen of the flows that opens as a ?state= preview. */
export const SCREENS = [
  ...PAGES,
  "/stop#a-token",
  "/areas/gurgaon",
  "/book?state=served",
  "/book?state=unserved",
  "/book?state=booked",
  "/book?state=listed",
  "/try?state=looks",
  "/try?state=gate",
  "/try?state=sent",
  "/try?state=error",
];
