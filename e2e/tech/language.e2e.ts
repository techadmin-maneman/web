// The app in Hindi (docs/prompts/tech-redesign.md, "Hindi and language switching"): one tap from the sign-in, or Me's
// Language row, and every screen is drawn again in it without a reload, a refusal already showing among them; the
// phone keeps the choice, past a sign-out too; and a visit part way through keeps its place.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { LOCAL_LOGIN_CODE } from "../../scripts/lib/local-stack.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { checklistItems, startedThrough, stepAction } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const HINDI = techCopy.languageNames.hi;
const ENGLISH = techCopy.languageNames.en;

/** Moves within the app as a tap does (packages/ui/router.tsx), so the page is never loaded again. */
async function goInApp(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/** A mark on the page itself: a reload would take it away. */
const marked = (page: Page) =>
  page.evaluate(() => {
    document.body.dataset.sameLoad = "yes";
  });

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

test("a refusal already on the sign-in is said again in the language chosen", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.signedIn = false;
  fake.codeClosed = true;
  await page.goto("/");
  await page.getByRole("textbox", { name: techCopy.signIn.mobileLabel }).fill("9811000000");
  await page.getByRole("button", { name: techCopy.signIn.sendCode }).click();
  await page.getByRole("textbox", { name: techCopy.signIn.codeLabel }).fill(LOCAL_LOGIN_CODE);
  await expect(page.getByRole("alert")).toHaveText(techCopy.signIn.errors.code_expired);

  await page.getByRole("button", { name: HINDI }).click();
  await expect(page.getByRole("alert")).toHaveText("यह कोड अब नहीं चलेगा। नया कोड लें।");
});

test("the language chosen outlasts a sign-out, which wipes the phone", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/me");
  await page.getByRole("button", { name: new RegExp(`^${techCopy.me.language}`) }).click();
  await page.getByRole("dialog").getByRole("radio", { name: HINDI }).click();
  await expect(page.getByRole("heading", { level: 1, name: "मैं" })).toBeVisible();

  await page.getByRole("button", { name: "साइन आउट", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "साइन आउट", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "साइन इन" })).toBeVisible();

  // Opened again, signed out as the server has it, the app reads the phone's choice before it draws.
  fake.signedIn = false;
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "साइन इन" })).toBeVisible();
});

test("Me's Language row switches every screen without a reload, and a visit keeps its place", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
  await marked(page);
  // One task a screen: the first done, on to the second, done.
  await checklistItems(page).first().click();
  await stepAction(page).click();
  await checklistItems(page).first().click();

  await goInApp(page, "/me");
  await page.getByRole("button", { name: new RegExp(`^${techCopy.me.language}`) }).click();
  // The choice closes the sheet as it is made.
  await page.getByRole("dialog").getByRole("radio", { name: HINDI }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "मैं" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^भाषा/ })).toContainText(HINDI);
  expect(await axeViolations(page)).toEqual([]);

  // Back to the visit within the app: its step and its ticks as they were, in Hindi, the page never loaded again.
  await goInApp(page, `/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: "सर्विस की चेकलिस्ट" })).toBeVisible();
  await expect(checklistItems(page).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveAttribute("data-same-load", "yes");
});

test("the close-out says what was decided in Hindi around ops' own reason, which stays as they wrote it", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.lostReasons = [{ id: "moved_away", label: "Client moved to another city" }];
  startedThrough(fake, "before_photos", "checklist", "consumables", "profile");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("button", { name: /^Mane Man Essential/ }).click();
  await stepAction(page).click();
  await page.getByRole("button", { name: techCopy.steps.outcome.done, exact: true }).click();
  await page.getByRole("button", { name: techCopy.steps.outcome.notNow }).click();
  await page.getByRole("button", { name: "Client moved to another city" }).click();
  await stepAction(page).click();
  await expect(page.getByText(techCopy.closeOut.notNow("Client moved to another city"))).toBeVisible();
  const closeOut = new URL(page.url()).pathname;

  await goInApp(page, "/me");
  await page.getByRole("button", { name: new RegExp(`^${techCopy.me.language}`) }).click();
  await page.getByRole("dialog").getByRole("radio", { name: HINDI }).click();
  await goInApp(page, closeOut);
  await expect(page.getByText("अभी नहीं · Client moved to another city", { exact: true })).toBeVisible();
});
