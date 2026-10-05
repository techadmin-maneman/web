// What axe cannot see in the client app (UX-18): a page that scrolls sideways when the screen is 320 px wide (WCAG
// 1.4.10), and a control that takes the keyboard without drawing that it has (2.4.7).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

/** Each signed-in page. */
const PAGES = ["/", "/visits", "/photos", "/payments", "/refer", "/profile"] as const;

/** Whether the element the keyboard is on draws a ring: an outline wider than nothing. Null on nothing. */
const ringDrawn = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) return null;
    const style = getComputedStyle(focused);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  });

test("reflows every page into 320 px without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide, `${path} scrolls sideways`).toBeLessThanOrEqual(320);
  }
});

test("draws where the keyboard is on every control of Home, in the order they come", async ({ page }) => {
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
  let seen = 0;
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab");
    const drawn = await ringDrawn(page);
    if (drawn === null) continue;
    seen += 1;
    const name = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40) ?? "");
    expect(drawn, `"${name}" takes the keyboard without a ring`).toBe(true);
  }
  expect(seen).toBeGreaterThan(3);
});
