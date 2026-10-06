// The console's Payments: a day's money over the charges it was kept
// on, today unless ops pick another day, then each charge a client disputed,
// with Refund and Uphold, then the queue of cases with the evidence ops rule
// on, and the ruling, then the cases ruled on today. The API is answered from
// e2e/ops/fixtures.ts, since no route can open a case from outside: a
// technician's phone closes a job as a no-show.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  answer,
  DAY_MONEY,
  DECIDED,
  DISPUTES,
  fails,
  json,
  NO_SHOW_UNMEASURED,
  NO_SHOWS,
  type Answer,
} from "./fixtures.ts";
import { FIRST, QUEUE, MONEY, CASE, PREVIEW, open, disputeCard } from "./no-shows-fixtures.ts";

const SECOND = "Visit of Mon 20 Sep";

const DECIDED_TODAY = "Decided today";

/** A case in the queue, found by the visit it heads. */
const caseOf = (page: Page, visit: string) =>
  page.getByRole("region", { name: QUEUE }).getByRole("listitem").filter({ hasText: visit });

/** One fact of a case's evidence, by the name the board letters it with. */
const fact = (page: Page, visit: string, name: string) =>
  caseOf(page, visit)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator("+ dd");

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

// The case once gave ops the phone's check-in and the wait the rules asked for,
// named no client and dated no reminder.
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

// A reminder never sent once read "Never delivered", as if the client's phone had been off.
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

// A check-in that passed only because ops let him in says so beside its distance.
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

// "Charge or waive, with a reason": charging was once one click, with no reason and no second look.
test("offers neither ruling until a reason is written", async ({ page }) => {
  await open(page);
  const first = caseOf(page, FIRST);
  await expect(first.getByRole("button", { name: "Charge" })).toBeDisabled();
  await expect(first.getByRole("button", { name: "Waive" })).toBeDisabled();
  await first.getByLabel("Your note · required").fill("   ");
  await expect(first.getByRole("button", { name: "Charge" })).toBeDisabled();
});

// The charge was once asked about with no figure: "Charge X for the visit of Fri 2 Oct?".
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

// After a charge the page once still said "Nothing was charged today", and the case was gone.
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
  // A waiver refunds the payment and returns the credit.
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

// The Tasks board links a no-show to its case here.
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
  expect(await axeViolations(page)).toEqual([]);

  const first = caseOf(page, FIRST);
  await first.getByLabel("Your note · required").fill("Nobody came down");
  await first.getByRole("button", { name: "Charge", exact: true }).click();
  expect(await axeViolations(page)).toEqual([]);
});

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
