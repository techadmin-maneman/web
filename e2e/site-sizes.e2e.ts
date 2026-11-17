// Every page of the site, and each screen of its flows, held at 360, 768 and 1024 px and at 360 with its text at 130%
// (docs/prompts/site-redesign.md, "Acceptance"; ./holds.ts says what holding is): nothing spills out of its box and
// nothing scrolls sideways. 390 and 1440 are the projects' own widths, which every other test runs at.

import { holds, named, type Size } from "./holds.ts";
import { fakeTurnstile, test } from "./support.ts";
import { SCREENS } from "./site-screens.ts";

const SIZES: readonly Size[] = [
  { width: 360, zoom: 1 },
  { width: 768, zoom: 1 },
  { width: 1024, zoom: 1 },
  { width: 360, zoom: 1.3 },
];

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

for (const path of SCREENS) {
  test(`${path} holds at 360, 768 and 1024 px and at 130% text`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "390", "the width is set here, so one project is enough");
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    for (const size of SIZES) await holds(page, size, `${path} at ${named(size)}`);
  });
}
