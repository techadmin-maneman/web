import { expect, test } from "../support.ts";
import { noRealCheckout } from "./checkout-fakes.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import {
  toPayment,
  toWindows,
  openSheet,
  holdAs,
  scanOf,
  passedThrough,
  LATE_FEE,
  FIRST_FIT,
  LATE_FEE_LINE,
} from "./booking-fixtures.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another, in
// order. One failing leaves the rest to run.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

/** A free_until already past: the window starts inside the notice the visit is sold under. */
const PASSED = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

// A visit sold inside its notice said "Free to move until" a time already gone.
test("says a visit sold inside its notice is charged to change from now, never free until a time gone", async ({
  page,
}) => {
  await holdAs(page, { free_until: PASSED() });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(
    pay.getByText(
      "This visit is less than 24 hours away: if you move or cancel it, the Rs. 2,000 paid isn’t refunded.",
    ),
  ).toBeVisible();
  await expect(pay.getByText(/Free to move/)).toHaveCount(0);
});

test("says a first fit sold inside its notice costs its late fee to change from now", async ({ page }) => {
  await holdAs(page, {
    type: "first_fit",
    price: FIRST_FIT,
    late_fee: LATE_FEE,
    late_change_charge: "late_fee",
    free_until: PASSED(),
  });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(
    pay.getByText(
      "This visit is less than 24 hours away: moving or cancelling it costs Rs. 4,720 (Rs. 4,000 + Rs. 720 GST).",
    ),
  ).toBeVisible();
  await expect(pay.getByText(/Free to move/)).toHaveCount(0);
});

test("says a free service visit is not returned for a visit it covers that is sold inside its notice", async ({
  page,
}) => {
  await holdAs(page, { credit: { remaining: 2 }, free_until: PASSED() });
  await toPayment(page);
  const confirm = page.getByRole("dialog", { name: "Confirm", exact: true });
  await expect(
    confirm.getByText(
      "This visit is less than 24 hours away: if you move or cancel it, the free service visit isn’t returned.",
    ),
  ).toBeVisible();
  await expect(confirm.getByText(/the free service visit is gone/)).toHaveCount(0);
});

// The windows inside the notice are still sold, and marked on the date and window steps.
test("marks the days and windows inside the notice, which are still sold", async ({ page }) => {
  await passedThrough(page, /\/api\/availability\?/, (days: { days: { windows: object[] }[] }) => ({
    ...days,
    days: days.days.map((day, index) => ({
      ...day,
      windows: day.windows.map((each) => ({ ...each, open: true, change_charged: index === 0 })),
    })),
  }));
  await openSheet(page);
  const dates = page.getByRole("dialog", { name: "Pick a date" });
  const marked = dates.getByRole("radio", { name: /, Within 24 hours: changes are charged$/ });
  await expect(marked).toHaveCount(1);
  await expect(dates.getByText("Within 24 hours: changes are charged")).toBeVisible();
  await marked.click();
  await dates.getByRole("button", { name: "Continue" }).click();
  const windows = page.getByRole("dialog", { name: "Pick a time" });
  await expect(windows.getByRole("radio").first()).toBeVisible();
  const open = await windows.getByRole("radio").count();
  await expect(windows.getByText("Within 24 hours: changes are charged")).toHaveCount(open);
  await scanOf(page);
});

// A free booking went through "Continue to payment" and "Pay and confirm" for Rs. 0.
test("takes a visit that costs nothing to Confirm, never to a payment", async ({ page }) => {
  const free = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
  await passedThrough(page, /\/api\/availability\?/, (days: { days: object[] }) => ({
    ...days,
    price: free,
    days: days.days.map((day) => ({ ...day, price: free })),
  }));
  await holdAs(page, { type: "consultation", price: free, late_change_charge: "nothing" });
  await toWindows(page);
  const windows = page.getByRole("dialog", { name: "Pick a time" });
  await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
  await expect(windows.getByRole("button", { name: "Continue to payment" })).toHaveCount(0);
  await windows.getByRole("button", { name: "Continue", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm", exact: true });
  await expect(confirm.getByText("Free", { exact: true })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Confirm visit" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Pay and confirm" })).toHaveCount(0);
});

test("says a visit moves or cancels free at any time where the booking is sold so", async ({ page }) => {
  await holdAs(page, { late_change_charge: "nothing" });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("Free to move or cancel at any time.")).toBeVisible();
  await expect(pay.getByText(/After that, changes are charged/)).toHaveCount(0);
});

test("says a credit is gone after a late cancel only where the booking is sold so", async ({ page }) => {
  await holdAs(page, { credit: { remaining: 2 }, late_change_charge: "nothing" });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Confirm", exact: true });
  await expect(pay.getByText("1 free service visit used")).toBeVisible();
  await expect(pay.getByText(/the free service visit is gone/)).toHaveCount(0);
  await expect(pay.getByText("Free to move or cancel at any time.")).toBeVisible();
});

test("says a credit is gone after a cancel inside the notice the booking is sold under", async ({ page }) => {
  await holdAs(page, { credit: { remaining: 2 }, change_notice_hours: 48 });
  await toPayment(page);
  await expect(
    page
      .getByRole("dialog", { name: "Confirm", exact: true })
      .getByText("Cancel inside 48 hours and the free service visit is gone."),
  ).toBeVisible();
});

test("writes the late fee to move a visit as the pay step does, and C7's way to C8 is a full target", async ({
  page,
}) => {
  await page.route(/\/api\/appointments\/[0-9a-f-]{36}\/reschedule$/, (route) =>
    route.fulfill({
      json: {
        visit_id: fittedClient().next.id,
        type: "first_fit",
        notice: "late",
        notice_hours: 24,
        free_until: new Date().toISOString(),
        paid: FIRST_FIT.amount,
        credit: null,
        cost: "late_fee",
        price: LATE_FEE,
      },
    }),
  );
  await logIn(page, fittedClient().mobile);
  await page.getByRole("button", { name: "Reschedule" }).click();
  const sheet = page.getByRole("dialog", { name: /^Move \w+day’s visit$/ });
  await expect(sheet.getByText(LATE_FEE_LINE)).toBeVisible();
  const instead = await sheet.getByRole("button", { name: "Cancel the visit instead" }).boundingBox();
  expect(instead?.height).toBeGreaterThanOrEqual(44);
});

test("draws a change's outcome in the serif's one weight, never a made-up bold", async ({ page }) => {
  await page.route(/\/api\/appointments\/[0-9a-f-]{36}\/reschedule$/, (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal_error", request_id: "e2e" } } }),
  );
  await logIn(page, fittedClient().mobile);
  await page.getByRole("button", { name: "Reschedule" }).click();
  const outcome = page.getByRole("dialog").getByRole("heading", { name: /^That didn’t go through/ });
  await expect(outcome).toBeVisible();
  expect(await outcome.evaluate((heading) => getComputedStyle(heading).fontWeight)).toBe("400");
});
