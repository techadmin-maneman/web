// No-shows (board D1's queue): the three facts ops rule on, and the ruling.
// The API is answered from e2e/ops/fixtures.ts, since no route can open a case
// from outside: a technician's phone closes a job as a no-show.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, NO_SHOW_UNMEASURED, NO_SHOWS } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIRST = "Visit of Sun 19 Sep";

async function open(page: Page, decision = json({ decided: true })): Promise<void> {
  await answer(page, {
    "/api/no-shows": json(NO_SHOWS),
    [`/api/no-shows/${NO_SHOWS.cases[0]?.id ?? ""}/decision`]: decision,
  });
  await page.goto("/no-shows");
  await expect(page.getByRole("heading", { name: "Waiting for a decision" })).toBeVisible();
}

test("reads the queue of undecided cases, not every case", async ({ page }) => {
  const asked = page.waitForRequest((request) => request.url().includes("/api/no-shows?"));
  await open(page);
  expect(new URL((await asked).url()).searchParams.get("decision")).toBe("undecided");
});

test("shows each case with the visit, the technician and the three facts", async ({ page }) => {
  await open(page);
  const queue = page.getByRole("region", { name: "Waiting for a decision" });
  await expect(queue.getByRole("listitem")).toHaveCount(2);

  const first = queue.getByRole("listitem").filter({ hasText: FIRST });
  await expect(first.getByText("Imran Qureshi attended")).toBeVisible();
  await expect(first.getByText("11:31 am")).toBeVisible();
  // The route gives the distance, not the radius that was in force, so no fence is lettered.
  await expect(first.getByText("240 m")).toBeVisible();
  await expect(first.getByText("Delivered 11:32 am")).toBeVisible();
  await expect(first.getByText("15 min · closed 11:47 am")).toBeVisible();
});

// ADR 0036: a distance that was never measured is not a distance of zero, and
// this queue is where a client is charged for being out. The words must stand
// where the number would, and no 0 may appear in the case at all.
test("says the distance was never measured, and shows no number, when the route carries none", async ({ page }) => {
  await answer(page, { "/api/no-shows": json(NO_SHOW_UNMEASURED) });
  await page.goto("/no-shows");

  const only = page.getByRole("listitem").filter({ hasText: FIRST });
  await expect(only.getByText("Not measured")).toBeVisible();
  await expect(only.getByText("0 m")).toBeHidden();
  await expect(only).not.toContainText(/\b0\s*m\b/);
});

test("says so when the visit's WhatsApp was never delivered", async ({ page }) => {
  await open(page);
  const second = page.getByRole("listitem").filter({ hasText: "Visit of Mon 20 Sep" });
  await expect(second.getByText("Never delivered")).toBeVisible();
});

test("charges a case, and the case leaves the queue", async ({ page }) => {
  await open(page);
  const first = page.getByRole("listitem").filter({ hasText: FIRST });
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await first.getByRole("button", { name: "Charge" }).click();
  expect((await sent).postDataJSON()).toEqual({ decision: "charged" });
  await expect(page.getByText(FIRST)).toBeHidden();
});

test("waives a case, and the case leaves the queue", async ({ page }) => {
  await open(page);
  const first = page.getByRole("listitem").filter({ hasText: FIRST });
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await first.getByRole("button", { name: "Waive" }).click();
  expect((await sent).postDataJSON()).toEqual({ decision: "waived" });
  await expect(page.getByText(FIRST)).toBeHidden();
});

test("shows no amount anywhere, since nothing is taken here", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Rs.")).toBeHidden();
  await expect(page.getByText("Charging records the decision. Nothing is taken from the client here.")).toBeVisible();
});

test("says so when someone else has ruled on the case already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  const first = page.getByRole("listitem").filter({ hasText: FIRST });
  await first.getByRole("button", { name: "Charge" }).click();
  await expect(page.getByRole("alert")).toContainText("Someone has ruled on this one already.");
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("says nothing is waiting when the queue is empty", async ({ page }) => {
  await answer(page, { "/api/no-shows": json({ cases: [] }) });
  await page.goto("/no-shows");
  await expect(page.getByText("No no-show is waiting for a decision.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "/api/no-shows": fails(503, "unavailable") });
  await page.goto("/no-shows");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/no-shows": json(NO_SHOWS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("meets WCAG 2.2 AA with a queue", async ({ page }) => {
  await open(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
