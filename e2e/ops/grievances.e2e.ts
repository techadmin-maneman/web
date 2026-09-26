// Grievances: the concerns clients have raised about their data, answered and
// closed here (docs/decisions/0049-dpdp.md). The API is answered from
// e2e/ops/fixtures.ts, since only a client's own app raises one. The clock is
// fixed to the day the fixture's dates are read against, so the days left of
// the answer time mean the same thing on every run.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, GRIEVANCES, json, TASKS_READ_ON, type Call } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIRST = GRIEVANCES.grievances[0];
const RESOLVE = `/api/grievances/${FIRST?.id ?? ""}/resolve` as const;
const ANSWER_IT: Call = `POST ${RESOLVE}`;

async function open(page: Page, resolve = json({ state: "resolved" })): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/grievances": json(GRIEVANCES), [ANSWER_IT]: resolve });
  await page.goto("/grievances");
  await expect(page.getByRole("heading", { level: 1, name: "Grievances" })).toBeVisible();
}

const queue = (page: Page) => page.getByRole("region", { name: "Open grievances" });
const row = (page: Page, name: string) => queue(page).getByRole("listitem").filter({ hasText: name });

test("lists every open grievance with the client's own words, number and day", async ({ page }) => {
  await open(page);
  await expect(queue(page).getByRole("listitem")).toHaveCount(2);

  const first = row(page, "Rohit Malhotra");
  await expect(first).toContainText("+91 98100 04417 · raised 14 Sep 2027");
  await expect(first.getByText(FIRST?.text ?? "")).toBeVisible();
});

test("says how long is left of the answer time, and marks one that has run over", async ({ page }) => {
  await open(page);
  await expect(row(page, "Rohit Malhotra")).toContainText("22 days left");
  await expect(row(page, "Vikram Sethi")).toContainText("Overdue 22");
  await expect(page.getByText("we answer within 30 days")).toBeVisible();
});

test("says plainly that recording an answer messages nobody", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Nothing here messages them")).toBeVisible();
});

test("reaches the client's record from the name", async ({ page }) => {
  await open(page);
  await row(page, "Rohit Malhotra").getByRole("link", { name: "Rohit Malhotra" }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001");
});

test("will not close a grievance with no answer written", async ({ page }) => {
  await open(page);
  await expect(row(page, "Rohit Malhotra").getByRole("button")).toBeDisabled();
});

test("records the answer, and the grievance leaves the queue", async ({ page }) => {
  await open(page);
  const first = row(page, "Rohit Malhotra");
  await first.getByRole("textbox", { name: "Your answer" }).fill("Taken off the launch list today.");

  const sent = page.waitForRequest((request) => request.url().endsWith(RESOLVE) && request.method() === "POST");
  await first.getByRole("button", { name: "Record the answer and close it" }).click();
  expect((await sent).postDataJSON()).toEqual({ response: "Taken off the launch list today." });
  await expect(page.getByText("Rohit Malhotra")).toBeHidden();
  // The row is gone, so the keyboard goes to the queue's heading and not to the top of the page.
  await expect(page.getByRole("heading", { name: "Open grievances" })).toBeFocused();
});

// Grievances are a group on the Tasks board now, which links each to its row here (OPS-08, OPS-05).
test("brings the grievance a task named into view, and gives it the keyboard", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/grievances": json(GRIEVANCES) });
  await page.goto(`/grievances#grievance-${FIRST?.id ?? ""}`);
  await expect(row(page, "Rohit Malhotra")).toBeFocused();
});

test("says so when someone has answered it already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  const first = row(page, "Rohit Malhotra");
  await first.getByRole("textbox", { name: "Your answer" }).fill("Answered on WhatsApp.");
  await first.getByRole("button", { name: "Record the answer and close it" }).click();
  await expect(page.getByRole("alert")).toContainText("Someone has answered this one already.");
});

test("says so when no grievance is open", async ({ page }) => {
  await answer(page, { "GET /api/grievances": json({ grievances: [] }) });
  await page.goto("/grievances");
  await expect(page.getByText("No grievance is open.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "GET /api/grievances": fails(503, "unavailable") });
  await page.goto("/grievances");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "GET /api/grievances": json(GRIEVANCES) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("meets WCAG 2.2 AA with a queue", async ({ page }) => {
  await open(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
