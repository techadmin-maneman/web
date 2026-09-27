// Board D1: the day's money over the charges it was kept on, then the queue of
// cases with the evidence ops rule on, and the ruling. The API is answered
// from e2e/ops/fixtures.ts, since no route can open a case from outside: a
// technician's phone closes a job as a no-show.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, DAY_MONEY, fails, json, NO_SHOW_UNMEASURED, NO_SHOWS, type Call } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIRST = "Visit of Sun 19 Sep";
const SECOND = "Visit of Mon 20 Sep";
const QUEUE = "Waiting for a decision";
const MONEY = "Today";
const CASE = NO_SHOWS.cases[0]?.id ?? "";
const DECIDE: Call = `POST /api/no-shows/${CASE}/decision`;

async function open(page: Page, decision = json({ decided: true }), path = "/no-shows"): Promise<void> {
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json(NO_SHOWS),
    [DECIDE]: decision,
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: QUEUE })).toBeVisible();
}

/** A case in the queue, found by the visit it heads. */
const caseOf = (page: Page, visit: string) =>
  page.getByRole("region", { name: QUEUE }).getByRole("listitem").filter({ hasText: visit });

/** One fact of a case's evidence, by the name the board letters it with. */
const fact = (page: Page, visit: string, name: string) =>
  caseOf(page, visit)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator("+ dd");

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
// would rule on nothing (docs/open-points.md, item 60).
test("says why the disputed charge is not built, and offers no Refund or Uphold", async ({ page }) => {
  await open(page);
  await expect(page.getByText("No client can raise a dispute yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refund" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Uphold" })).toBeHidden();
});

test("says so when nothing was charged on the day", async ({ page }) => {
  await answer(page, {
    "GET /api/payments": json({
      ...DAY_MONEY,
      collected: 0,
      refunds_processing: 0,
      refunded: 0,
      charged: 0,
      no_shows_charged: 0,
      charges: [],
    }),
    "GET /api/no-shows": json(NO_SHOWS),
  });
  await page.goto("/no-shows");
  await expect(page.getByText("Nothing was charged today.")).toBeVisible();
  // A day on which nothing came in is a nought, which is true and not a guess.
  await expect(page.getByRole("region", { name: MONEY }).getByText("Rs. 0").first()).toBeVisible();
  await expect(page.getByText("not charged yet")).toBeHidden();
});

test("says so when the day's money cannot be loaded, and leaves the queue standing", async ({ page }) => {
  await answer(page, { "GET /api/payments": fails(503, "unavailable"), "GET /api/no-shows": json(NO_SHOWS) });
  await page.goto("/no-shows");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("reads the queue of undecided cases, not every case", async ({ page }) => {
  const asked = page.waitForRequest((request) => request.url().includes("/api/no-shows?"));
  await open(page);
  expect(new URL((await asked).url()).searchParams.get("decision")).toBe("undecided");
});

// The case once gave ops the phone's check-in and the wait the rules asked for,
// named no client and dated no reminder (OPS-03).
test("shows each case's client, the booked window, both clocks and the evidence", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("region", { name: QUEUE }).getByRole("listitem")).toHaveCount(2);

  const first = caseOf(page, FIRST);
  await expect(first.getByRole("link", { name: "Vikram Sethi" })).toBeVisible();
  await expect(first.getByText("Imran Qureshi attended")).toBeVisible();
  await expect(fact(page, FIRST, "Booked")).toHaveText("Sun 19 Sep, 11:30 am to 1 pm");
  await expect(fact(page, FIRST, "Check-in")).toHaveText("11:31 am · 1 m after the booked start");
  await expect(fact(page, FIRST, "Reached us")).toHaveText("Sun 19 Sep, 11:31 am");
  // The route gives the distance, not the radius that was in force, so no fence is lettered.
  await expect(fact(page, FIRST, "Distance")).toHaveText("240 m");
  await expect(fact(page, FIRST, "WhatsApp")).toHaveText("Delivered Sun 19 Sep, 11:32 am");
  // From the check-in to the close, not the fifteen minutes the rules asked for.
  await expect(fact(page, FIRST, "Waited")).toHaveText("16 min · closed 11:47 am");
});

test("says how long the case had been with us when the check-in reached us late", async ({ page }) => {
  await open(page);
  await expect(fact(page, SECOND, "Check-in")).toHaveText("10 am · 1 h after the booked start");
  await expect(fact(page, SECOND, "Reached us")).toHaveText("Mon 20 Sep, 10:20 am");
  await expect(fact(page, SECOND, "Waited")).toHaveText(
    "36 min by the phone, 16 since it reached us · closed 10:36 am",
  );
});

test("shows what the phone said when the bounds would not take its time", async ({ page }) => {
  const claimed = { ...NO_SHOWS.cases[0], phone_checked_in_at: "2027-09-19T04:00:00.000Z" };
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json({ cases: [claimed] }) });
  await page.goto("/no-shows");
  await expect(fact(page, FIRST, "The phone said")).toHaveText("Sun 19 Sep, 9:30 am");
});

// A reminder never sent once read "Never delivered", as if the client's phone had been off (OPS-03).
test("says no reminder went to a client who never agreed to WhatsApp about visits", async ({ page }) => {
  await open(page);
  await expect(fact(page, SECOND, "WhatsApp")).toHaveText(
    "No reminder sent · the client has not agreed to WhatsApp about visits",
  );
});

test("tells a reminder sent and never delivered from one that was never sent", async ({ page }) => {
  const cases = [
    { ...NO_SHOWS.cases[0], message_state: "sent", message_delivered_at: null },
    { ...NO_SHOWS.cases[1], message_state: "none" },
  ];
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json({ cases }) });
  await page.goto("/no-shows");
  await expect(fact(page, FIRST, "WhatsApp")).toHaveText("Sent, and never delivered");
  await expect(fact(page, SECOND, "WhatsApp")).toHaveText("No reminder was sent");
});

// ADR 0036: a distance that was never measured is not a distance of zero, and
// this queue is where a client is charged for being out. The words must stand
// where the number would, and no 0 may appear in the case at all.
test("says the distance was never measured, and shows no number, when the route carries none", async ({ page }) => {
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json(NO_SHOW_UNMEASURED) });
  await page.goto("/no-shows");

  const only = page.getByRole("listitem").filter({ hasText: FIRST });
  await expect(only.getByText("Not measured")).toBeVisible();
  await expect(only.getByText("0 m")).toBeHidden();
  await expect(only).not.toContainText(/\b0\s*m\b/);
});

test("reaches the client's visits from the case", async ({ page }) => {
  await open(page);
  await caseOf(page, FIRST).getByRole("link", { name: "Vikram Sethi" }).click();
  expect(new URL(page.url()).pathname).toBe(`/clients/${NO_SHOWS.cases[0]?.person.id ?? ""}/visits`);
});

// "Charge or waive, with a reason": charging was once one click, with no reason and no second look (FEO-11).
test("offers neither ruling until a reason is written", async ({ page }) => {
  await open(page);
  const first = caseOf(page, FIRST);
  await expect(first.getByRole("button", { name: "Charge" })).toBeDisabled();
  await expect(first.getByRole("button", { name: "Waive" })).toBeDisabled();
  await first.getByLabel("Your note · required").fill("   ");
  await expect(first.getByRole("button", { name: "Charge" })).toBeDisabled();
});

test("asks once more before it charges, and sends the reason with the charge", async ({ page }) => {
  await open(page);
  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Delivered the evening before; nobody came down");
  await first.getByRole("button", { name: "Charge", exact: true }).click();

  const confirm = first.getByRole("group", { name: /^Charge Vikram Sethi for the visit of Sun 19 Sep\?/ });
  await expect(confirm).toBeFocused();
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await confirm.getByRole("button", { name: "Charge the visit" }).click();
  expect((await sent).postDataJSON()).toEqual({
    decision: "charged",
    reason: "Delivered the evening before; nobody came down",
  });
  await expect(page.getByText(FIRST)).toBeHidden();
  // The case is gone, so the keyboard goes to the queue's heading and not to the top of the page.
  await expect(page.getByRole("heading", { name: QUEUE })).toBeFocused();
});

test("sends nothing when the charge is taken back, and hands the keyboard to Charge", async ({ page }) => {
  let sent = 0;
  await open(page, (route) => {
    sent += 1;
    return json({ decided: true })(route);
  });
  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Delivered the evening before");
  await first.getByRole("button", { name: "Charge", exact: true }).click();
  await first.getByRole("button", { name: "Back" }).click();
  await expect(first.getByRole("button", { name: "Charge", exact: true })).toBeFocused();
  expect(sent).toBe(0);
});

test("waives a case with its reason, and the case leaves the queue", async ({ page }) => {
  await open(page);
  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("He was stuck in the lift; we have his call");
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await first.getByRole("button", { name: "Waive" }).click();
  expect((await sent).postDataJSON()).toEqual({
    decision: "waived",
    reason: "He was stuck in the lift; we have his call",
  });
  await expect(page.getByText(FIRST)).toBeHidden();
});

test("shows no amount in the queue, and says what a charge keeps and a waiver does not yet give back", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("region", { name: QUEUE }).getByText("Rs.")).toBeHidden();
  // BIZ-28: what a waiver gives back waits for the owner, so ops are told it refunds nothing yet.
  await expect(page.getByText(/keeps what the visit took\. Waiving records it too, but refunds nothing/)).toBeVisible();
});

test("says so when someone else has ruled on the case already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Nobody came down");
  await first.getByRole("button", { name: "Waive" }).click();
  await expect(page.getByRole("alert")).toContainText("Someone has ruled on this one already.");
  await expect(page.getByText(FIRST)).toBeVisible();
});

// The Tasks board links a no-show to its case here (OPS-05).
test("brings the case a task named into view, and gives it the keyboard", async ({ page }) => {
  await open(page, undefined, `/no-shows#case-${CASE}`);
  await expect(caseOf(page, FIRST)).toBeFocused();
});

test("says nothing is waiting when the queue is empty", async ({ page }) => {
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json({ cases: [] }) });
  await page.goto("/no-shows");
  await expect(page.getByText("No no-show is waiting for a decision.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": fails(503, "unavailable") });
  await page.goto("/no-shows");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json(NO_SHOWS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("meets WCAG 2.2 AA with the day's money and a queue, and with a charge asked about", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Nobody came down");
  await first.getByRole("button", { name: "Charge", exact: true }).click();
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);
});
