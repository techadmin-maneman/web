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

// The before and after pairs as they were framed before the redesign: the results whole, at their photographs' own
// 4:5, and the try-on's pair on the client's framing, which keeps the hair in the band.
test.describe("the before and after pairs", () => {
  test("show the results whole, and the try-on's hair", async ({ page }) => {
    await page.goto("/");
    const result = page.locator('[data-section="results"] img').first();
    await result.scrollIntoViewIfNeeded();
    const shape = await result.evaluate((image) => {
      const box = image.getBoundingClientRect();
      return Math.round((box.width / box.height) * 100) / 100;
    });
    expect(shape).toBe(0.8);
    const teaser = page.locator('[data-section="teaser"] img');
    await expect(teaser).toHaveCount(2);
    for (const image of await teaser.all()) {
      expect(await image.evaluate((element) => getComputedStyle(element).objectPosition)).toBe("50% 28%");
    }
  });
});
