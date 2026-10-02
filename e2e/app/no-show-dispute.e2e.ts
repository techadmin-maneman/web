// A visit the client was not home for, which ops charged, and the client's dispute of the charge
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). No route can make a no-show from outside, so the fitted
// client's first fit (e2e/app/fitted.ts) is answered as one, charged its late fee, and the dispute's route is answered
// too; each answer is held to the API's contract (e2e/contract.ts).

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { assertInContract } from "../contract.ts";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Dispute = "open" | "refunded" | "upheld" | null;

/** The first fit as a no-show ops charged Rs. 4,000, with its dispute where it stands. */
async function charged(page: Page, dispute: Dispute): Promise<string> {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const path = `/api/visits/${client.firstFit.id}`;
  // Read by the page, whose app.localhost only the browser resolves.
  const visit = await page.evaluate(async (url) => (await fetch(url)).json() as Promise<object>, path);
  const body = {
    ...visit,
    outcome: "no_show",
    no_show: {
      decision: "charged",
      waited_minutes: 16,
      charge: { kept: 400_000, credit_spent: false },
      dispute,
      disputable: dispute === null,
    },
  };
  assertInContract("client", "GET", path, 200, body);
  await page.route(`**${path}`, (route) => route.fulfill({ json: body }));
  await page.goto(`/visits/${client.firstFit.id}`);
  return client.firstFit.id;
}

test("says what the charge kept, and offers its dispute", async ({ page }) => {
  await charged(page, null);
  await expect(page.getByText("We came, and waited 16 minutes, but nobody was home.")).toBeVisible();
  await expect(page.getByText("Charged: we kept Rs. 4,000 of what you paid.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Dispute this charge" })).toBeVisible();
});

test("sends the dispute with the client's words, and says it is with us", async ({ page }) => {
  const visitId = await charged(page, null);
  const disputed = `/api/visits/${visitId}/dispute`;
  assertInContract("client", "POST", disputed, 201, { state: "open" });
  await page.route(`**${disputed}`, (route) => route.fulfill({ status: 201, json: { state: "open" } }));

  await page.getByRole("button", { name: "Dispute this charge" }).click();
  const sheet = page.getByRole("dialog", { name: "Dispute this charge" });
  await expect(sheet.getByRole("button", { name: "Send" })).toBeDisabled();
  await sheet.getByLabel("Why is the charge wrong?").fill("I was home all morning. Nobody rang the bell.");
  const sent = page.waitForRequest((request) => request.url().endsWith(disputed) && request.method() === "POST");
  await sheet.getByRole("button", { name: "Send" }).click();
  expect((await sent).postDataJSON()).toEqual({ reason: "I was home all morning. Nobody rang the bell." });
  // The sheet is named by its heading, which now says the dispute is with us.
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("We have your dispute.");
});

// The owner ruled on 30 September 2026: a charge may be disputed for 30 days after it (src/policy/no-show.ts).
test("says the days to dispute have passed, when they pass while the sheet is open", async ({ page }) => {
  const visitId = await charged(page, null);
  const disputed = `/api/visits/${visitId}/dispute`;
  const closed = { error: { code: "dispute_window_closed", request_id: "r-1" } };
  assertInContract("client", "POST", disputed, 409, closed);
  await page.route(`**${disputed}`, (route) => route.fulfill({ status: 409, json: closed }));
  await page.getByRole("button", { name: "Dispute this charge" }).click();
  const sheet = page.getByRole("dialog", { name: "Dispute this charge" });
  await sheet.getByLabel("Why is the charge wrong?").fill("I was home all morning.");
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "The days to dispute this charge have passed.",
  );
});

test("says a dispute is being looked at, and offers no second one", async ({ page }) => {
  await charged(page, "open");
  await expect(page.getByText("You disputed this charge. We are looking at it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Dispute this charge" })).toHaveCount(0);
});

test("says how ops ruled on the dispute", async ({ page }) => {
  await charged(page, "upheld");
  await expect(page.getByText("Charged: we kept Rs. 4,000 of what you paid.")).toBeVisible();
  await expect(page.getByText("We looked at your dispute. The charge stands.")).toBeVisible();
});

// A refund undoes the charge, so the page says only the outcome, never "we kept" above "refunded".
test("says only that the charge was refunded, once ops refund it", async ({ page }) => {
  await charged(page, "refunded");
  await expect(page.getByText("We looked at your dispute and refunded the charge.")).toBeVisible();
  await expect(page.getByText("Charged: we kept Rs. 4,000 of what you paid.")).toHaveCount(0);
});

test("meets WCAG 2.2 AA with the charge, and with its dispute open", async ({ page }) => {
  await charged(page, null);
  await expect(page.getByRole("button", { name: "Dispute this charge" })).toBeVisible();
  const page1 = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(page1.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("button", { name: "Dispute this charge" }).click();
  await expect(page.getByRole("dialog", { name: "Dispute this charge" })).toBeVisible();
  const sheet = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(sheet.violations.map((violation) => violation.id)).toEqual([]);
});
