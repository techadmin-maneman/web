// The site's look on every built page (ADR 0262): IBM Plex Sans is the only typeface a page loads.

import { expect, fakeTurnstile, test, visit } from "./support.ts";
import * as siteCopy from "../site/src/content/site.ts";

const PAGES = [
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

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

for (const path of PAGES) {
  test(`${path} loads IBM Plex Sans alone`, async ({ page }) => {
    const files: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") files.push(new URL(request.url()).pathname);
    });
    // The home page's islands wait to be scrolled to, so it is opened, not visited (e2e/accessibility.e2e.ts).
    if (path === "/") await page.goto(path);
    else await visit(page, path);
    const families = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts]
        .filter((face) => face.status === "loaded")
        .map((face) => face.family.replace(/"/g, ""));
    });
    expect([...new Set(families)]).toEqual(["IBM Plex Sans"]);
    expect(files.filter((file) => !file.includes("ibm-plex-sans"))).toEqual([]);
  });
}
