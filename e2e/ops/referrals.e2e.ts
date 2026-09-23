// Referrals (boards C1 and C2): the held queue and the referrers' figures,
// with the API answered from e2e/ops/fixtures.ts, since no route can put a
// grant into the held state from outside.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, HELD, json, REFERRERS } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIRST = "Rohit Malhotra → Vikram Sethi";

async function open(page: Page, decision = json({ state: "approved" })): Promise<void> {
  await answer(page, {
    "/api/referrals/held": json(HELD),
    "/api/referrers": json(REFERRERS),
    [`/api/referrals/${HELD.held[0]?.id ?? ""}/decision`]: decision,
  });
  await page.goto("/referrals");
  await expect(page.getByRole("heading", { name: "Held for review" })).toBeVisible();
}

test("lists every held grant with the rule it met, and counts them", async ({ page }) => {
  await open(page);
  const queue = page.getByRole("region", { name: "Held for review" });
  await expect(queue.getByRole("listitem").filter({ hasText: "→" })).toHaveCount(3);
  await expect(queue.getByText(FIRST)).toBeVisible();
  await expect(queue.getByText("Same address")).toBeVisible();
  await expect(queue.getByText("Same UPI handle")).toBeVisible();
  await expect(queue.getByText("Monthly cap exceeded")).toBeVisible();
  // The route gives the day of the first fit, not how long the grant has waited.
  await expect(queue.getByText("Fitted Sun 19 Sep")).toBeVisible();
});

test("asks why before it approves one, and sends the reason with the approval", async ({ page }) => {
  await open(page);
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: "Approve", exact: true }).click();

  const confirm = grant.getByRole("button", { name: "Approve the grant" });
  await expect(confirm).toBeDisabled();
  await grant.getByLabel("Why you are approving it").fill("Father and son, two households");
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await confirm.click();
  expect((await sent).postDataJSON()).toEqual({ decision: "approve", reason: "Father and son, two households" });
  await expect(page.getByText(FIRST)).toBeHidden();
});

test("asks why before it rejects one, and will not send an empty reason", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: "Reject", exact: true }).click();

  const confirm = grant.getByRole("button", { name: "Reject the grant" });
  await expect(confirm).toBeDisabled();
  await grant.getByLabel("Why you are rejecting it").fill("Same flat, one household");
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await confirm.click();
  expect((await sent).postDataJSON()).toEqual({ decision: "reject", reason: "Same flat, one household" });
  await expect(page.getByText(FIRST)).toBeHidden();
});

test("says so when someone else has decided the grant already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: "Approve", exact: true }).click();
  await grant.getByLabel("Why you are approving it").fill("Two households at one address");
  await grant.getByRole("button", { name: "Approve the grant" }).click();
  await expect(page.getByRole("alert")).toContainText("Someone has decided this one already.");
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("shows every referrer's figures, the busiest first, as the route orders them", async ({ page }) => {
  await open(page);
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("Karan Bose");
  await expect(rows.nth(1)).toContainText("19");
  await expect(page.getByText("Opens and consultations stay here.")).toBeVisible();
});

test("says nothing is held when the queue is empty", async ({ page }) => {
  await answer(page, { "/api/referrals/held": json({ held: [] }), "/api/referrers": json(REFERRERS) });
  await page.goto("/referrals");
  await expect(page.getByText("Nothing is held for review.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "/api/referrals/held": fails(503, "unavailable"), "/api/referrers": json(REFERRERS) });
  await page.goto("/referrals");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/referrals/held": json(HELD), "/api/referrers": json(REFERRERS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("meets WCAG 2.2 AA with a queue, and with a rejection open", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await page
    .getByRole("listitem")
    .filter({ hasText: FIRST })
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  const rejecting = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(rejecting.violations.map((violation) => violation.id)).toEqual([]);
});
