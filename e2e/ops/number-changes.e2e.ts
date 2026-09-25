// Number changes: the changes waiting for ops to confirm, both numbers already
// proven by code (docs/decisions/0042-client-profile.md). The API is answered
// from e2e/ops/fixtures.ts, since a change is started in a client's own app and
// needs a code sent to each number. The clock is fixed to the day the
// fixture's dates are read against, so the days left mean the same on every run.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, NUMBER_CHANGES, TASKS_READ_ON } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const CHANGE = NUMBER_CHANGES.changes[0]?.id ?? "";
const DECISION = `/api/number-changes/${CHANGE}/decision`;

async function open(page: Page, decision = json({ state: "confirmed" }), path = "/number-changes"): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "/api/number-changes": json(NUMBER_CHANGES), [DECISION]: decision });
  await page.goto(path);
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

// A number change once showed no age at all (OPS-08); it falls due when the Tasks board says it does.
test("says how long the change has left, as the Tasks board counts it", async ({ page }) => {
  await open(page);
  await expect(queue(page).getByRole("listitem")).toContainText("1 day left");
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
  // The keyboard goes back to the button that asked, not to the top of the page.
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeFocused();
});

test("moves the keyboard into the reason as it opens, and to the heading once decided", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const reason = page.getByRole("textbox", { name: "Why you are rejecting it" });
  await expect(reason).toBeFocused();
  await reason.fill("The client says they did not ask.");
  await page.getByRole("button", { name: "Reject the change" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for ops" })).toBeFocused();
});

// The Tasks board links a number change to its row here (OPS-05).
test("brings the change a task named into view, and gives it the keyboard", async ({ page }) => {
  await open(page, undefined, `/number-changes#change-${CHANGE}`);
  await expect(queue(page).getByRole("listitem")).toBeFocused();
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
