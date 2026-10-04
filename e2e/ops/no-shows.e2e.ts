// Board D1, the console's Payments: a day's money over the charges it was kept
// on, today unless ops pick another day, then each charge a client disputed,
// with Refund and Uphold, then the queue of cases with the evidence ops rule
// on, and the ruling, then the cases ruled on today. The API is answered from
// e2e/ops/fixtures.ts, since no route can open a case from outside: a
// technician's phone closes a job as a no-show.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  answer,
  CHARGE_PREVIEW,
  DAY_MONEY,
  DECIDED,
  DISPUTES,
  fails,
  json,
  NO_SHOW_UNMEASURED,
  NO_SHOWS,
  TASKS_READ_ON,
  type Answer,
  type Call,
} from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIRST = "Visit of Sun 19 Sep";
const SECOND = "Visit of Mon 20 Sep";
const QUEUE = "No-shows waiting for a decision";
/** The fixture's day, which the clock is set to: Wednesday 22 September 2027. */
const MONEY = "Today, Wed 22 Sep";
const CASE = NO_SHOWS.cases[0]?.id ?? "";
const DECIDE: Call = `POST /api/no-shows/${CASE}/decision`;
const DISPUTE = DISPUTES.disputes[0]?.id ?? "";
const RULE: Call = `POST /api/no-shows/disputes/${DISPUTE}/ruling`;
const DISPUTED = "Vikram Sethi disputes the charge";
const DISPUTES_QUEUE = "Disputed charges";
const DECIDED_TODAY = "Decided today";
const PREVIEW: Call = `GET /api/no-shows/${CASE}/charge`;

async function open(
  page: Page,
  decision = json({ decided: true }),
  path = "/no-shows",
  ruling = json({ ruled: true }),
): Promise<void> {
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json(NO_SHOWS),
    "GET /api/no-shows/disputes": json(DISPUTES),
    "GET /api/no-shows/decided": json(DECIDED),
    [PREVIEW]: json(CHARGE_PREVIEW),
    [DECIDE]: decision,
    [RULE]: ruling,
  });
  await page.clock.setFixedTime(TASKS_READ_ON);
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

// MON-16 and OIA-08 of the audit, 2 October 2026: the money sat under "No-shows", only ever today's.
test("is the console's Payments, at the address No-shows had", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Payments" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("shows another day's money when asked, and names the day it is for", async ({ page }) => {
  const monday = { ...DAY_MONEY, date: "2027-09-20", collected: 1_200_000, charges: [] };
  const asked: string[] = [];
  await open(page);
  await answer(page, {
    "GET /api/payments": (route) => {
      const date = new URL(route.request().url()).searchParams.get("date");
      if (date !== null) asked.push(date);
      return json(date === "2027-09-20" ? monday : DAY_MONEY)(route);
    },
  });
  await page.getByLabel("Day", { exact: true }).fill("2027-09-20");

  const money = page.getByRole("region", { name: "Mon 20 Sep" });
  await expect(money.getByRole("heading", { level: 2 })).toHaveText("Mon 20 Sep");
  await expect(money.getByText("Collected", { exact: true })).toBeVisible();
  await expect(money.getByText("Rs. 12,000")).toBeVisible();
  await expect(money.getByText("Rs. 2,360 went back that day")).toBeVisible();
  await expect(money.getByText("Nothing was charged that day.")).toBeVisible();
  expect([...new Set(asked)]).toEqual(["2027-09-20"]);
});

test("heads the day with the board's three figures, as money", async ({ page }) => {
  await open(page);
  const money = page.getByRole("region", { name: MONEY, exact: true });
  await expect(money.getByText("Collected today")).toBeVisible();
  await expect(money.getByText("Rs. 84,000")).toBeVisible();
  await expect(money.getByText("Refunds processing")).toBeVisible();
  await expect(money.getByText("Rs. 7,080")).toBeVisible();
  await expect(money.getByText("Rs. 2,360 went back today")).toBeVisible();
});

// The board prices a no-show like a late cancellation, and the charge records what it kept
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md): the figure adds both, and leaves nothing out.
test("adds what a charged no-show kept to the charges figure", async ({ page }) => {
  await open(page);
  const money = page.getByRole("region", { name: MONEY, exact: true });
  await expect(money.getByText("Charges and no-shows")).toBeVisible();
  await expect(money.getByText("Rs. 4,720")).toBeVisible();
  await expect(money.getByText("not charged yet")).toBeHidden();
});

test("lists each charge with its client, its amount and the evidence for it", async ({ page }) => {
  await open(page);
  const charge = page.getByRole("listitem").filter({ hasText: "Vikram Sethi · cancelled late" });
  await expect(charge.getByText("Rs. 2,360")).toBeVisible();
  await expect(charge.getByText("Cancelled 9:14 am · visit was 10 am")).toBeVisible();
});

test("lists a charged no-show with what its charge kept, and the evidence", async ({ page }) => {
  await open(page);
  const charge = page.getByRole("listitem").filter({ hasText: "Karan Bose · no-show" });
  await expect(charge.getByText("Rs. 2,360")).toBeVisible();
  await expect(charge.getByText("Imran Qureshi attended · visit was 11:30 am")).toBeVisible();
});

// A no-show charged before a charge recorded what it kept: words, never a nought.
test("says a no-show's amount was not recorded where its charge kept none on record", async ({ page }) => {
  const unrecorded = {
    ...DAY_MONEY,
    charged: 236_000,
    charges: DAY_MONEY.charges.map((charge) => (charge.kind === "no_show" ? { ...charge, amount: null } : charge)),
  };
  await answer(page, { "GET /api/payments": json(unrecorded), "GET /api/no-shows": json(NO_SHOWS) });
  await page.goto("/no-shows");
  const charge = page.getByRole("listitem").filter({ hasText: "Karan Bose · no-show" });
  await expect(charge.getByText("Amount not recorded")).toBeVisible();
  await expect(charge.getByText("Rs.")).toBeHidden();
});

/** Board D1's second card, found by its heading. */
const disputeCard = (page: Page) => page.getByRole("region", { name: DISPUTED });

// A disputed charge once floated between the panels, with no count and nothing that could link to it (OIA-07).
test("lists the disputed charges in a queue with their count, and opens the one a task names", async ({ page }) => {
  await open(page, undefined, `/no-shows#dispute-${DISPUTE}`);
  const queue = page.getByRole("region", { name: DISPUTES_QUEUE });
  await expect(queue.getByRole("listitem")).toHaveCount(1);
  await expect(queue.getByText("1", { exact: true })).toBeVisible();
  await expect(queue.getByRole("listitem").filter({ hasText: DISPUTED })).toBeFocused();
});

test("draws a disputed charge: the client's words, what the charge took, and the board's four rows", async ({
  page,
}) => {
  await open(page);
  const card = disputeCard(page);
  await expect(card.getByText("Disputed charge")).toBeVisible();
  await expect(card.getByText("I was home all morning. Nobody rang the bell.")).toBeVisible();
  await expect(card.getByText("The charge kept Rs. 2,360, for the visit of Sat 18 Sep.")).toBeVisible();
  const row = (name: string) =>
    card
      .getByRole("term")
      .filter({ hasText: new RegExp(`^${name}$`) })
      .locator("+ dd");
  await expect(row("Check-in")).toHaveText("11:31 am");
  await expect(row("Distance")).toHaveText("240 m · over 200 m fence");
  await expect(row("WhatsApp")).toHaveText("Delivered 11:32 am");
  await expect(row("Waited")).toHaveText("16 min · closed 11:47 am");
});

// FLD-52: a check-in held over a day was re-timed to when it reached us, and read as the phone's own time.
test("says beside a disputed check-in when the bounds moved the phone's time", async ({ page }) => {
  const dispute = DISPUTES.disputes[0];
  const moved = {
    ...dispute,
    checked_in_at: "2027-09-18T07:33:00.000Z",
    phone_checked_in_at: "2027-09-18T03:48:00.000Z",
  };
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json(NO_SHOWS),
    "GET /api/no-shows/disputes": json({ disputes: [moved] }),
    "GET /api/no-shows/decided": json(DECIDED),
  });
  await page.goto("/no-shows");
  const checkIn = disputeCard(page)
    .getByRole("term")
    .filter({ hasText: /^Check-in$/ })
    .locator("+ dd");
  await expect(checkIn).toHaveText("1:03 pm · phone time adjusted (phone said 9:18 am)");
});

// OIA-16: the name was plain text, and the client could not be reached from the card.
test("reaches the client's visits from their name, and the client on WhatsApp or by phone", async ({ page }) => {
  await open(page);
  const card = disputeCard(page);
  const person = DISPUTES.disputes[0]?.person;
  await expect(card.getByRole("link", { name: "Vikram Sethi", exact: true })).toHaveAttribute(
    "href",
    `/clients/${person?.id ?? ""}/visits`,
  );
  await expect(card.getByRole("link", { name: "WhatsApp Vikram Sethi" })).toHaveAttribute(
    "href",
    "https://wa.me/919810060916",
  );
  await expect(card.getByRole("link", { name: "Call Vikram Sethi on +91 98100 60916" })).toHaveAttribute(
    "href",
    "tel:+919810060916",
  );
});

// FLD-35: a reminder that was skipped read "Not delivered" on the evidence a refund is ruled on.
test("says on a disputed charge that the reminder never went, where it was not sent", async ({ page }) => {
  const disputes = [{ ...DISPUTES.disputes[0], message_state: "not_sent", message_delivered_at: null }];
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json(NO_SHOWS),
    "GET /api/no-shows/disputes": json({ disputes }),
    "GET /api/no-shows/decided": json(DECIDED),
  });
  await page.clock.setFixedTime(TASKS_READ_ON);
  await page.goto("/no-shows");
  const whatsapp = disputeCard(page)
    .getByRole("term")
    .filter({ hasText: /^WhatsApp$/ })
    .locator("+ dd");
  await expect(whatsapp).toHaveText("Not sent");
});

test("offers Refund and Uphold only once the note is written, and sends the ruling with it", async ({ page }) => {
  await open(page);
  const card = disputeCard(page);
  await expect(card.getByRole("button", { name: "Refund" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Uphold" })).toBeDisabled();
  await card.getByLabel("Your note · required").fill("The bell was broken that week");

  const sent = page.waitForRequest((request) => request.url().includes("/ruling") && request.method() === "POST");
  // Read again once ruled, as the board does: the dispute has gone.
  await answer(page, { "GET /api/no-shows/disputes": json({ disputes: [] }), [RULE]: json({ ruled: true }) });
  await card.getByRole("button", { name: "Refund" }).click();
  expect((await sent).postDataJSON()).toEqual({ ruling: "refunded", reason: "The bell was broken that week" });
  await expect(page.getByText(DISPUTED)).toBeHidden();
  await expect(page.getByRole("region", { name: DISPUTES_QUEUE }).getByText("No charge is disputed.")).toBeVisible();
  // The dispute is gone, so the keyboard goes to the queue's heading.
  await expect(page.getByRole("heading", { name: DISPUTES_QUEUE })).toBeFocused();
});

test("upholds a charge with its note", async ({ page }) => {
  await open(page);
  const card = disputeCard(page);
  await card.getByLabel("Your note · required").fill("He rang twice and waited");
  const sent = page.waitForRequest((request) => request.url().includes("/ruling") && request.method() === "POST");
  await card.getByRole("button", { name: "Uphold" }).click();
  expect((await sent).postDataJSON()).toEqual({ ruling: "upheld", reason: "He rang twice and waited" });
});

test("says so when someone else has ruled on the dispute already", async ({ page }) => {
  await open(page, undefined, undefined, fails(404, "not_found"));
  const card = disputeCard(page);
  await card.getByLabel("Your note · required").fill("The bell was broken");
  await card.getByRole("button", { name: "Uphold" }).click();
  await expect(card.getByRole("alert")).toContainText("Someone has ruled on this dispute already.");
});

test("says so when nothing was charged on the day", async ({ page }) => {
  await answer(page, {
    "GET /api/payments": json({
      ...DAY_MONEY,
      collected: 0,
      refunds_processing: 0,
      refunded: 0,
      charged: 0,
      charges: [],
    }),
    "GET /api/no-shows": json(NO_SHOWS),
  });
  await page.clock.setFixedTime(TASKS_READ_ON);
  await page.goto("/no-shows");
  await expect(page.getByText("Nothing was charged today.")).toBeVisible();
  // A day on which nothing came in is a nought, which is true and not a guess.
  await expect(page.getByRole("region", { name: MONEY, exact: true }).getByText("Rs. 0").first()).toBeVisible();
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
  // Against the radius in force when he checked in, as the board letters it.
  await expect(fact(page, FIRST, "Distance")).toHaveText("240 m · over 200 m fence");
  await expect(fact(page, SECOND, "Distance")).toHaveText("12 m · inside 200 m fence");
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
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json({ ...NO_SHOWS, cases: [claimed] }),
  });
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
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json({ ...NO_SHOWS, cases }) });
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

// FLD-24: a check-in that passed only because ops let him in says so beside its distance.
test("says when ops let the technician check in past the fence, and why", async ({ page }) => {
  const [first, ...rest] = NO_SHOWS.cases;
  const letIn = { ...first, let_in: { by: "ops@maneman.test", reason: "The pin is at the society gate" } };
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json({ ...NO_SHOWS, cases: [letIn, ...rest] }),
  });
  await page.goto("/no-shows");
  await expect(fact(page, FIRST, "Distance")).toHaveText(
    "240 m · over 200 m fence · ops let him check in: The pin is at the society gate",
  );
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

// The charge was once asked about with no figure: "Charge X for the visit of Fri 2 Oct?" (MON-17).
test("asks once more before it charges, with what it keeps, and sends the reason with the charge", async ({ page }) => {
  await open(page);
  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Delivered the evening before; nobody came down");
  await first.getByRole("button", { name: "Charge", exact: true }).click();

  const confirm = first.getByRole("group", { name: "Keep Rs. 2,360 of the Rs. 2,360 paid?" });
  await expect(confirm).toBeFocused();
  await expect(confirm).toHaveAccessibleDescription(
    "Charging Vikram Sethi for the visit of Sun 19 Sep cannot be undone here.",
  );
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

test("says what a charge keeps and what it refunds, and what it keeps of a credit", async ({ page }) => {
  await open(page);
  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Nobody came down");
  const ask = async (preview: object) => {
    await answer(page, { [PREVIEW]: json(preview) });
    await first.getByRole("button", { name: "Charge", exact: true }).click();
  };

  await ask({ paid: 3_000_000, kept: 400_000, credit_kept: false });
  await expect(first.getByText("Keep Rs. 4,000 of the Rs. 30,000 paid, and refund Rs. 26,000?")).toBeVisible();
  await first.getByRole("button", { name: "Back" }).click();

  await ask({ paid: 0, kept: 0, credit_kept: true });
  await expect(first.getByText("Keep the free service visit it was booked with?")).toBeVisible();
});

test("sends no charge until it knows what the charge keeps", async ({ page }) => {
  await open(page);
  await answer(page, { [PREVIEW]: fails(503, "unavailable") });
  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Nobody came down");
  await first.getByRole("button", { name: "Charge", exact: true }).click();
  await expect(first.getByText("We could not work out what the charge keeps.")).toBeVisible();
  await expect(first.getByRole("button", { name: "Charge the visit" })).toBeDisabled();
});

// After a charge the page once still said "Nothing was charged today", and the case was gone (MON-17).
test("lists the cases ruled on today with their ruling, and reads them and the day's money again after a ruling", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("region", { name: MONEY, exact: true })).toBeVisible();
  const decided = page.getByRole("region", { name: DECIDED_TODAY });
  await expect(decided.getByRole("listitem").filter({ hasText: "Karan Bose" })).toContainText(
    "Charged · kept Rs. 2,360 · 10:30 am",
  );
  await expect(decided.getByRole("listitem").filter({ hasText: "Arjun Mehra" })).toContainText("Waived · 9:05 am");

  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("He was stuck in the lift; we have his call");
  const readAgain = Promise.all([
    page.waitForRequest((request) => request.url().includes("/api/no-shows/decided")),
    page.waitForRequest((request) => request.url().includes("/api/payments")),
  ]);
  await first.getByRole("button", { name: "Waive" }).click();
  await readAgain;
});

test("says so when nothing has been decided today", async ({ page }) => {
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json(NO_SHOWS),
    "GET /api/no-shows/decided": json({ cases: [] }),
  });
  await page.goto("/no-shows");
  await expect(page.getByRole("region", { name: DECIDED_TODAY })).toContainText("Nothing has been decided today.");
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

test("shows no amount in the queue, and says what a charge costs and a waiver gives back", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("region", { name: QUEUE }).getByText("Rs.")).toBeHidden();
  // BIZ-28: the owner ruled on 27 September 2026 that a waiver refunds the payment and returns the credit.
  await expect(
    page.getByText(/a no-show costs and refunds the rest; waiving refunds the payment and returns its credit\./),
  ).toBeVisible();
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

// What a waiver gives back is ops' to set (docs/decisions/0088-every-policy-in-the-console.md).
test("says beneath the queue what waiving gives back, as ops set it", async ({ page }) => {
  await open(page);
  await expect(page.getByText("refunds the payment and returns its credit")).toBeVisible();
  const kept = { ...NO_SHOWS, waiver: { payment: "kept", credit: "spent" } };
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json(kept) });
  await page.goto("/no-shows");
  await expect(page.getByText("keeps the payment and leaves its credit spent")).toBeVisible();
});

test("says nothing is waiting when the queue is empty", async ({ page }) => {
  await answer(page, { "GET /api/payments": json(DAY_MONEY), "GET /api/no-shows": json({ ...NO_SHOWS, cases: [] }) });
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

test("meets WCAG 2.2 AA with the day's money, a disputed charge and a queue, and with a charge asked about", async ({
  page,
}) => {
  await open(page);
  await expect(disputeCard(page)).toBeVisible();
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Nobody came down");
  await first.getByRole("button", { name: "Charge", exact: true }).click();
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);
});

/** Who is signed in once the Staff list is enforced: Finance nationally at `level`, and the calls that opens. */
const financeAt = (level: "view" | "act", rulings: readonly string[]) =>
  json({
    signed_in_as: "money@maneman.in",
    sign_out: "/cdn-cgi/access/logout",
    staff: {
      enforced: true,
      listed: true,
      grants: [{ department: "finance", level, geography: "national", place: null }],
      may_call: [
        "GET /api/health",
        "GET /api/whoami",
        "GET /api/payments",
        "GET /api/no-shows",
        "GET /api/no-shows/decided",
        "GET /api/no-shows/disputes",
        ...rulings,
      ],
    },
  });

async function openAs(page: Page, whoami: Answer): Promise<void> {
  await answer(page, {
    "GET /api/whoami": whoami,
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json(NO_SHOWS),
    "GET /api/no-shows/disputes": json(DISPUTES),
    "GET /api/no-shows/decided": json(DECIDED),
  });
  await page.goto("/no-shows");
  await expect(page.getByRole("heading", { name: QUEUE })).toBeVisible();
}

// Each action asks the level it needs, in the console as in the API: a waiver and a refund give money back, so they
// are Finance Manage's, where charging and upholding are Act's.
test("offers Finance Act a charge and an uphold, and leaves waiving and refunding to Finance Manage", async ({
  page,
}) => {
  await openAs(page, financeAt("act", ["POST /api/no-shows/{id}/decision", "POST /api/no-shows/disputes/{id}/ruling"]));
  const first = caseOf(page, FIRST);
  await expect(first.getByRole("button", { name: "Charge", exact: true })).toBeVisible();
  await expect(first.getByRole("button", { name: "Waive" })).toHaveCount(0);
  await expect(disputeCard(page).getByRole("button", { name: "Uphold" })).toBeVisible();
  await expect(disputeCard(page).getByRole("button", { name: "Refund" })).toHaveCount(0);
});

test("shows Finance View the cases and the disputes, with nothing to rule on", async ({ page }) => {
  await openAs(page, financeAt("view", []));
  const first = caseOf(page, FIRST);
  await expect(fact(page, FIRST, "Check-in")).toBeVisible();
  await expect(first.getByRole("button")).toHaveCount(0);
  await expect(first.getByRole("textbox")).toHaveCount(0);
  await expect(disputeCard(page).getByRole("button")).toHaveCount(0);
  await expect(disputeCard(page).getByRole("textbox")).toHaveCount(0);
});
