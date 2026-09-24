// Board D1: the day's money over the charges it was kept on, then the queue of
// cases with the three facts ops rule on, and the ruling. The API is answered
// from e2e/ops/fixtures.ts, since no route can open a case from outside: a
// technician's phone closes a job as a no-show.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, DAY_MONEY, fails, json, NO_SHOW_UNMEASURED, NO_SHOWS } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIRST = "Visit of Sun 19 Sep";
const QUEUE = "Waiting for a decision";
const MONEY = "Today";

async function open(page: Page, decision = json({ decided: true })): Promise<void> {
  await answer(page, {
    "/api/payments": json(DAY_MONEY),
    "/api/no-shows": json(NO_SHOWS),
    [`/api/no-shows/${NO_SHOWS.cases[0]?.id ?? ""}/decision`]: decision,
  });
  await page.goto("/no-shows");
  await expect(page.getByRole("heading", { name: QUEUE })).toBeVisible();
}

test("heads the day with the board's three figures, as money", async ({ page }) => {
  await open(page);
  const money = page.getByRole("region", { name: MONEY });
  await expect(money.getByText("Collected today")).toBeVisible();
  await expect(money.getByText("Rs. 84,000")).toBeVisible();
  await expect(money.getByText("Refunds processing")).toBeVisible();
  await expect(money.getByText("Rs. 7,080")).toBeVisible();
  await expect(money.getByText("Rs. 2,360 went back today")).toBeVisible();
});

// The board prices a no-show like a late cancellation. Nothing here records
// what one was charged, so the figure holds what was kept and says what it
// leaves out, rather than a total that reads as the whole of the day's charges.
test("counts the no-shows beside the charges figure instead of pricing them", async ({ page }) => {
  await open(page);
  const money = page.getByRole("region", { name: MONEY });
  await expect(money.getByText("Charges and no-shows")).toBeVisible();
  await expect(money.getByText("1 no-show not charged yet")).toBeVisible();
});

test("lists each charge with its client, its amount and the evidence for it", async ({ page }) => {
  await open(page);
  const charge = page.getByRole("listitem").filter({ hasText: "Vikram Sethi · cancelled late" });
  await expect(charge.getByText("Rs. 2,360")).toBeVisible();
  await expect(charge.getByText("Cancelled 9:14 am · visit was 10 am")).toBeVisible();
});

// Ops rule on the evidence and the charge itself is applied at P2-M5, so no
// amount is recorded anywhere: words, never a nought.
test("says a no-show is not charged yet, and puts no amount against it", async ({ page }) => {
  await open(page);
  const charge = page.getByRole("listitem").filter({ hasText: "Karan Bose · no-show" });
  await expect(charge.getByText("Not charged yet")).toBeVisible();
  await expect(charge.getByText("Imran Qureshi attended · visit was 11:30 am")).toBeVisible();
  await expect(charge.getByText("Rs.")).toBeHidden();
});

// Nothing records a disputed charge and no client can raise one, so the board's
// second card is a line saying so rather than a Refund and an Uphold that
// would rule on nothing (docs/open-points.md, item 57).
test("says why the disputed charge is not built, and offers no Refund or Uphold", async ({ page }) => {
  await open(page);
  await expect(page.getByText("No client can raise a dispute yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refund" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Uphold" })).toBeHidden();
});

test("says so when nothing was charged on the day", async ({ page }) => {
  await answer(page, {
    "/api/payments": json({
      ...DAY_MONEY,
      collected: 0,
      refunds_processing: 0,
      refunded: 0,
      charged: 0,
      no_shows_charged: 0,
      charges: [],
    }),
    "/api/no-shows": json(NO_SHOWS),
  });
  await page.goto("/no-shows");
  await expect(page.getByText("Nothing was charged today.")).toBeVisible();
  // A day on which nothing came in is a nought, which is true and not a guess.
  await expect(page.getByRole("region", { name: MONEY }).getByText("Rs. 0").first()).toBeVisible();
  await expect(page.getByText("not charged yet")).toBeHidden();
});

test("says so when the day's money cannot be loaded, and leaves the queue standing", async ({ page }) => {
  await answer(page, { "/api/payments": fails(503, "unavailable"), "/api/no-shows": json(NO_SHOWS) });
  await page.goto("/no-shows");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");
  await expect(page.getByText(FIRST)).toBeVisible();
});

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
  await answer(page, { "/api/payments": json(DAY_MONEY), "/api/no-shows": json(NO_SHOW_UNMEASURED) });
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

test("shows no amount in the queue, since nothing is taken there", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("region", { name: QUEUE }).getByText("Rs.")).toBeHidden();
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
  await answer(page, { "/api/payments": json(DAY_MONEY), "/api/no-shows": json({ cases: [] }) });
  await page.goto("/no-shows");
  await expect(page.getByText("No no-show is waiting for a decision.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "/api/payments": json(DAY_MONEY), "/api/no-shows": fails(503, "unavailable") });
  await page.goto("/no-shows");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/payments": json(DAY_MONEY), "/api/no-shows": json(NO_SHOWS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("meets WCAG 2.2 AA with the day's money and a queue", async ({ page }) => {
  await open(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
