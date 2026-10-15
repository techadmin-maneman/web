// What axe cannot see in the console: a control that takes the keyboard without drawing that it has (WCAG
// 2.4.7). The skip link that comes first is console.e2e.ts's.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, TASKS, TASKS_READ_ON } from "./fixtures.ts";
import { open } from "./settings-fixtures.ts";
import { tasks, shell } from "../../apps/ops/src/content.ts";

/** Whether the element the keyboard is on draws a ring: an outline wider than nothing. Null on nothing. */
const ringDrawn = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) return null;
    const style = getComputedStyle(focused);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  });

test("draws where the keyboard is on the navigation and the Tasks board, in the order they come", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: tasks.title })).toBeVisible();
  let seen = 0;
  for (let press = 0; press < 30; press += 1) {
    await page.keyboard.press("Tab");
    const drawn = await ringDrawn(page);
    if (drawn === null) continue;
    seen += 1;
    const name = await page.evaluate(() => document.activeElement?.textContent.trim().slice(0, 40) ?? "");
    expect(drawn, `"${name}" takes the keyboard without a ring`).toBe(true);
  }
  expect(seen).toBeGreaterThan(20);
});

// Only the section scrolls: a long page, its rules' legends hidden for a screen reader, never scrolls the console's
// frame, so the navigation stays where it is.
test("keeps the navigation in place while a long section scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await open(page, "/settings");
  const scrollsPastTheWindow = () => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
  expect(await scrollsPastTheWindow()).toBe(false);
  await page.getByRole("main").evaluate((main) => {
    main.scrollTop = main.scrollHeight;
  });
  await expect(page.getByRole("navigation", { name: shell.title })).toBeInViewport();
});
