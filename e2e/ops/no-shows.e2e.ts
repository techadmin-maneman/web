import { expect, test } from "../support.ts";
import { answer, DAY_MONEY, DECIDED, DISPUTES, fails, json, NO_SHOWS, TASKS_READ_ON } from "./fixtures.ts";
import { FIRST, MONEY, DISPUTE, RULE, DISPUTED, open, disputeCard } from "./no-shows-fixtures.ts";

const DISPUTES_QUEUE = "Disputed charges";

// The money sat under "No-shows", only ever today's.
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

// A disputed charge once floated between the panels, with no count and nothing that could link to it.
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

// A check-in held over a day was re-timed to when it reached us, and read as the phone's own time.
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

// The name was plain text, and the client could not be reached from the card.
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

// A reminder that was skipped read "Not delivered" on the evidence a refund is ruled on.
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
