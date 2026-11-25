// The site's look on every built page (ADR 0262): IBM Plex Sans is the only typeface a page loads, and no page draws
// paper or wash.

import type { Locator, Page } from "@playwright/test";
import { expect, fakeTurnstile, test, visit } from "./support.ts";
import { answerOpen, mockApi, NOON_2_OCTOBER, openDays, openForm } from "./book-fixtures.ts";
import { PAGES, SCREENS, SCROLLED_TO } from "./site-screens.ts";

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

for (const path of PAGES) {
  test(`${path} loads IBM Plex Sans alone`, async ({ page }) => {
    const files: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") files.push(new URL(request.url()).pathname);
    });
    // The home page's islands, and the Gurgaon page's, wait to be scrolled to, so they are opened, not visited.
    if (SCROLLED_TO.includes(path)) await page.goto(path);
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

/** The brand's paper family and the client app's wash, none of which the redesign draws on the site (ADR 0262). */
const PAPER = [
  "--paper",
  "--paper-light",
  "--paper-line",
  "--paper-control",
  "--paper-hint",
  "--paper-shade",
  "--wash-100",
];

/** Each paper colour the page's own elements draw: "a.item color=--paper". */
async function paperDrawn(page: Page, scope: Locator): Promise<string[]> {
  return scope.evaluateAll((elements, names) => {
    const probe = document.createElement("i");
    document.body.append(probe);
    const paper = new Map(
      names.map((name) => {
        probe.style.color = `var(${name})`;
        return [getComputedStyle(probe).color, name];
      }),
    );
    probe.remove();
    const found = new Set<string>();
    for (const element of elements) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      for (const side of ["color", "background-color", "outline-color", "border-top-color", "border-bottom-color"]) {
        const name = paper.get(style.getPropertyValue(side));
        if (name === undefined) continue;
        if (side.startsWith("border") && parseFloat(style.getPropertyValue(side.replace("color", "width"))) === 0)
          continue;
        if (side === "outline-color" && style.outlineStyle === "none") continue;
        found.add(
          `${element.tagName.toLowerCase()}.${(element.getAttribute("class") ?? "").split(" ")[0] ?? ""} ${side}=${name}`,
        );
      }
    }
    return [...found];
  }, PAPER);
}

// The redesign draws no paper and no wash (ADR 0262): not at rest, nor on a link or a button under the pointer, where a
// shared look once turned the ink's words paper.
test.describe("no paper or wash", () => {
  for (const path of SCREENS) {
    test(`on ${path}, at rest or pointed at`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      expect(await paperDrawn(page, page.locator("body *"))).toEqual([]);
      const controls = page.locator("a:visible, button:visible");
      const pointed: string[] = [];
      for (const control of await controls.all()) {
        if (!(await control.isVisible())) continue;
        await control.hover({ timeout: 2_000 }).catch(() => undefined);
        pointed.push(...(await paperDrawn(page, control)));
      }
      expect([...new Set(pointed)]).toEqual([]);
    });
  }
});

// A day full in every window draws its windows closed, a choice that cannot be chosen: in the site's pale grey, not the
// apps' paper.
test("a full window on /book draws no paper", async ({ page }) => {
  await page.clock.setFixedTime(NOON_2_OCTOBER);
  await mockApi(page);
  await answerOpen(page, () => openDays({ "2026-10-03": { morning: false, afternoon: true, evening: true } }));
  await openForm(page);
  await expect(page.getByRole("radio", { name: /^Morning/ })).toBeDisabled();
  expect(await paperDrawn(page, page.locator("body *"))).toEqual([]);
});

// Under reduced motion nothing moves on its own (WCAG 2.3.3; global.css stops every animation and transition): no
// animation runs once the page has settled, the hero's turning line included.
test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const path of SCREENS) {
    test(`on ${path}, nothing moves`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running")
          .map((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return `${target?.tagName.toLowerCase() ?? "?"}.${target?.getAttribute("class")?.split(" ")[0] ?? ""}`;
          }),
      );
      expect(running).toEqual([]);
    });
  }
});
