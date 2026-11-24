// Every action in the console is its icon, its words its name and shown above it on a pointer's rest or the
// keyboard's arrival (docs/decisions/0316-every-console-action-an-icon.md). Growth · Words stands in for every page:
// its head's Publish is one such action. Every name is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json } from "./answer.ts";
import { words as copy } from "../../apps/ops/src/content/words.ts";

const LINE = {
  key: "site:home/hero.title",
  surface: "site",
  group: "Home",
  where: "hero",
  text: "A hair system, fitted at home.",
  reviewed: false,
  now: "Hair, fitted at home.",
  changed: { by: "growth@maneman.test", at: "2026-10-05T06:30:00.000Z" },
  longest: 50,
  on_site: false,
} as const;

async function open(page: Page) {
  await answer(page, {
    "GET /api/words": json({ words: [LINE], published: null, messages: "at_once" }),
    "GET /api/words/history": json({ versions: [] }),
  });
  await page.goto("/words");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const publish = (page: Page) => page.getByRole("button", { name: copy.publish.openCount(1), exact: true });
/** The one label every action's words are shown in, drawn for the eye alone. */
const tip = (page: Page) => page.locator("[popover]");

test("draws an action as its icon, its words its name", async ({ page }) => {
  await open(page);
  const button = publish(page);
  await expect(button.locator("svg")).toBeVisible();
  const box = await button.boundingBox();
  if (box === null) throw new Error("Publish is not drawn");
  // A square, its words out of sight.
  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  await expect(tip(page)).toBeHidden();
});

test("shows an action's words above it as the pointer rests, and takes them away on Escape", async ({ page }) => {
  await open(page);
  await publish(page).hover();
  await expect(tip(page)).toBeVisible();
  await expect(tip(page)).toHaveText(copy.publish.openCount(1));
  const button = await publish(page).boundingBox();
  const label = await tip(page).boundingBox();
  if (button === null || label === null) throw new Error("not drawn");
  expect(label.y + label.height).toBeLessThanOrEqual(button.y);

  await page.keyboard.press("Escape");
  await expect(tip(page)).toBeHidden();
});

test("shows an action's words as the keyboard comes to it", async ({ page }) => {
  await open(page);
  await publish(page).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(publish(page)).toBeFocused();
  await expect(tip(page)).toHaveText(copy.publish.openCount(1));
  await expect(tip(page)).toBeVisible();
});

test.describe("under a finger", () => {
  test.use({ hasTouch: true });

  test("shows an action's words on a long press, and the press does not act", async ({ page }) => {
    await open(page);
    const box = await publish(page).boundingBox();
    if (box === null) throw new Error("Publish is not drawn");
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
    await expect(tip(page)).toHaveText(copy.publish.openCount(1));
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // Long enough for a click that follows the press to have opened Publish's question.
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { name: copy.publish.title })).toHaveCount(0);
  });
});
