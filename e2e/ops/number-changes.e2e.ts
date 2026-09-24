// Number changes: the changes waiting for ops to confirm, both numbers already
// proven by code (docs/decisions/0042-client-profile.md). The API is answered
// from e2e/ops/fixtures.ts, since a change is started in a client's own app and
// needs a code sent to each number.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, NUMBER_CHANGES } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DECISION = `/api/number-changes/${NUMBER_CHANGES.changes[0]?.id ?? ""}/decision`;

async function open(page: Page, decision = json({ state: "confirmed" })): Promise<void> {
  await answer(page, { "/api/number-changes": json(NUMBER_CHANGES), [DECISION]: decision });
  await page.goto("/number-changes");
  await expect(page.getByRole("heading", { level: 1, name: "Number changes" })).toBeVisible();
}

const queue = (page: Page) => page.getByRole("region", { name: "Waiting for ops" });

test("shows both numbers, the day it was asked for, and that each was proven", async ({ page }) => {
  await open(page);
  const only = queue(page).getByRole("listitem");
  await expect(only).toHaveCount(1);
  await expect(only).toContainText("+919810004417 → +919810004421");
  await expect(only).toContainText("Requested 21 Sep 2027");
  await expect(only).toContainText("A code went to both numbers, and both were entered.");
});

test("says what confirming does before it is confirmed", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Confirming moves the client to the new number.")).toBeVisible();
});

test("reaches the client's record from the name", async ({ page }) => {
  await open(page);
  await queue(page).getByRole("link", { name: "Rohit Malhotra" }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001");
});

test("confirms the change, and it leaves the queue", async ({ page }) => {
  await open(page);
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await page.getByRole("button", { name: "Confirm the change" }).click();
  expect((await sent).postDataJSON()).toEqual({ decision: "confirm", reason: null });
  await expect(page.getByText("Rohit Malhotra")).toBeHidden();
});

test("rejects with a reason, which it will not send without", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const send = page.getByRole("button", { name: "Reject the change" });
  await expect(send).toBeDisabled();

  await page.getByRole("textbox", { name: "Why you are rejecting it" }).fill("The client says they did not ask.");
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await send.click();
  expect((await sent).postDataJSON()).toEqual({ decision: "reject", reason: "The client says they did not ask." });
  await expect(page.getByText("Rohit Malhotra")).toBeHidden();
});

test("leaves the change waiting when the rejection is called off", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: "Leave it waiting" }).click();
  await expect(page.getByRole("button", { name: "Confirm the change" })).toBeVisible();
});

// The API answers with the code alone, so the console says whose number it is.
test("says so when another client already holds the new number", async ({ page }) => {
  await open(page, fails(409, "number_in_use"));
  await page.getByRole("button", { name: "Confirm the change" }).click();
  await expect(page.getByRole("alert")).toContainText("Another client holds that number already.");
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("says so when someone has decided it already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await page.getByRole("button", { name: "Confirm the change" }).click();
  await expect(page.getByRole("alert")).toContainText("Someone has decided this one already.");
});

test("says so when nothing is waiting", async ({ page }) => {
  await answer(page, { "/api/number-changes": json({ changes: [] }) });
  await page.goto("/number-changes");
  await expect(page.getByText("No number change is waiting.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "/api/number-changes": fails(503, "unavailable") });
  await page.goto("/number-changes");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/number-changes": json(NUMBER_CHANGES) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("meets WCAG 2.2 AA with a queue, and with a rejection open", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);
});
