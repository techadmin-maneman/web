// Number changes: the changes waiting for ops to confirm, both numbers already
// proven by code (docs/decisions/0042-client-profile.md). The API is answered
// from e2e/ops/fixtures.ts, since a change is started in a client's own app and
// needs a code sent to each number. The clock is fixed to the day the
// fixture's dates are read against, so the days left mean the same on every run.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, json, NUMBER_CHANGES, TASKS_READ_ON, type Call } from "./fixtures.ts";

const CHANGE = NUMBER_CHANGES.changes[0]?.id ?? "";
const DECISION = `/api/number-changes/${CHANGE}/decision` as const;
const DECIDE: Call = `POST ${DECISION}`;

async function open(page: Page, decision = json({ state: "confirmed" }), path = "/number-changes"): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/number-changes": json(NUMBER_CHANGES), [DECIDE]: decision });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Number changes" })).toBeVisible();
}

const queue = (page: Page) => page.getByRole("region", { name: "Waiting for a decision" });

test("shows both numbers, the day it was asked for, and that each was proven", async ({ page }) => {
  await open(page);
  const only = queue(page).getByRole("listitem");
  await expect(only).toHaveCount(1);
  await expect(only).toContainText("+91 98100 04417 → +91 98100 04421");
  await expect(only).toContainText("Requested 21 Sep 2027");
  await expect(only).toContainText("Both numbers verified by code.");
});

// The change is confirmed with the client on the new number, which had to be copied by hand.
test("reaches the client on the new number, on WhatsApp or by phone", async ({ page }) => {
  await open(page);
  const only = queue(page).getByRole("listitem");
  await expect(only.getByRole("link", { name: "WhatsApp Rohit Malhotra" })).toHaveAttribute(
    "href",
    "https://wa.me/919810004421",
  );
  await expect(only.getByRole("link", { name: "Call Rohit Malhotra on +91 98100 04421" })).toHaveAttribute(
    "href",
    "tel:+919810004421",
  );
});

// A number change once showed no age at all; it falls due when the Tasks board says it does.
test("says how long the change has left, as the Tasks board counts it", async ({ page }) => {
  await open(page);
  await expect(queue(page).getByRole("listitem")).toContainText("1 day left");
});

test("says what confirming does before it is confirmed", async ({ page }) => {
  await open(page);
  await expect(page.getByText("The client signs in with the new number from then on.")).toBeVisible();
});

test("reaches the client's record from the name", async ({ page }) => {
  await open(page);
  await queue(page).getByRole("link", { name: "Rohit Malhotra", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001/visits");
});

test("confirms the change, and it leaves the queue", async ({ page }) => {
  await open(page);
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await page.getByRole("button", { name: "Confirm" }).click();
  expect((await sent).postDataJSON()).toEqual({ decision: "confirm", reason: null });
  await expect(page.getByText("Rohit Malhotra")).toBeHidden();
});

test("rejects with a reason, which it will not send without", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const send = page.getByRole("button", { name: "Reject change" });
  await expect(send).toBeDisabled();

  await page.getByRole("textbox", { name: "Reason" }).fill("The client says they did not ask.");
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await send.click();
  expect((await sent).postDataJSON()).toEqual({ decision: "reject", reason: "The client says they did not ask." });
  await expect(page.getByText("Rohit Malhotra")).toBeHidden();
});

test("leaves the change waiting when the rejection is called off", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
  // The keyboard goes back to the button that asked, not to the top of the page.
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeFocused();
});

test("moves the keyboard into the reason as it opens, and to the heading once decided", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const reason = page.getByRole("textbox", { name: "Reason" });
  await expect(reason).toBeFocused();
  await reason.fill("The client says they did not ask.");
  await page.getByRole("button", { name: "Reject change" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for a decision" })).toBeFocused();
});

// The Tasks board links a number change to its row here.
test("brings the change a task named into view, and gives it the keyboard", async ({ page }) => {
  await open(page, undefined, `/number-changes#change-${CHANGE}`);
  await expect(queue(page).getByRole("listitem")).toBeFocused();
});

// The API answers with the code alone, so the console says whose number it is.
test("says so when another client already holds the new number", async ({ page }) => {
  await open(page, fails(409, "number_in_use"));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert")).toContainText("Another client already has that number.");
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("says so when someone has decided it already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert")).toContainText("Already decided. Reload.");
});

test("says so when nothing is waiting", async ({ page }) => {
  await answer(page, { "GET /api/number-changes": json({ changes: [] }) });
  await page.goto("/number-changes");
  await expect(page.getByText("No number changes.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "GET /api/number-changes": fails(503, "unavailable") });
  await page.goto("/number-changes");
  await expect(page.getByRole("alert")).toContainText("Couldn't load this.");

  await answer(page, { "GET /api/number-changes": json(NUMBER_CHANGES) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("meets WCAG 2.2 AA with a queue, and with a rejection open", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  expect(await axeViolations(page)).toEqual([]);
});
