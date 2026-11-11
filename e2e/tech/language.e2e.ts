// The app in Hindi (docs/prompts/tech-redesign.md, "Hindi and language switching"): one tap from the sign-in, or Me's
// Language row, and every screen is drawn again in it without a reload; the phone keeps the choice, and a visit part
// way through keeps its place.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { checklistItems, startedThrough, stepAction } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const HINDI = techCopy.languageNames.hi;
const ENGLISH = techCopy.languageNames.en;

test("the sign-in switches to Hindi in one tap, and the phone keeps the choice", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.signedIn = false;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: techCopy.signIn.title })).toBeVisible();

  await page.getByRole("button", { name: HINDI }).click();
  await expect(page.getByRole("heading", { level: 1, name: "साइन इन" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "मोबाइल नंबर" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("button", { name: ENGLISH })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "साइन इन" })).toBeVisible();

  await page.getByRole("button", { name: ENGLISH }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.signIn.title })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("Me's Language row switches every screen without a reload, and a visit keeps its place", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
  // One task a screen: the first done, on to the second, done.
  await checklistItems(page).first().click();
  await stepAction(page).click();
  await checklistItems(page).first().click();

  await page.goto("/me");
  // A mark on the page itself: a reload would take it away.
  await page.evaluate(() => {
    document.body.dataset.sameLoad = "yes";
  });
  await page.getByRole("button", { name: new RegExp(`^${techCopy.me.language}`) }).click();
  // The choice closes the sheet as it is made.
  await page.getByRole("dialog").getByRole("radio", { name: HINDI }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "मैं" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^भाषा/ })).toContainText(HINDI);
  await expect(page.locator("body")).toHaveAttribute("data-same-load", "yes");
  expect(await axeViolations(page)).toEqual([]);

  // The visit opens where it was, its second task still done, in Hindi.
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: "सर्विस की चेकलिस्ट" })).toBeVisible();
  await expect(checklistItems(page).first()).toHaveAttribute("aria-pressed", "true");
});
