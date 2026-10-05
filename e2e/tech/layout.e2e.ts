// What axe cannot see in the technician app: a screen that scrolls sideways on a phone 320 px wide (WCAG
// 1.4.10). Its board is drawn at 390; the narrowest phones in use are 320.

import { expect, test } from "../support.ts";
import { fakeTech, JOB_ID } from "./fixtures.ts";

const SCREENS = ["/", `/jobs/${JOB_ID}`, `/jobs/${JOB_ID}/checklist`, "/waiting"] as const;

test("reflows Today, a job's card, a step and the waiting list into 320 px without scrolling sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await fakeTech(page);
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide, `${path} scrolls sideways`).toBeLessThanOrEqual(320);
  }
});
