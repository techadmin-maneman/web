// Booking in the app for the fitted client with an address of
// e2e/app/booker.ts, against the local mm-api, with Razorpay faked
// (e2e/app/checkout-fakes.ts): the address asked for first when there is none
// (ADR 0079), what booking also agrees to on the pay step (ADR 0080), and the
// service booked: picked first where its kind offers more than one, the one
// the app offers chosen (ADR 0085, ADR 0086).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { checkoutOnTop, confirmedByRazorpay, fakeCheckout, noRealCheckout } from "./checkout-fakes.ts";
import { FREE_UNTIL, toPayment, profileAs, type Hold, holdAs, scanOf } from "./booking-fixtures.ts";
import * as appCopy from "../../apps/app/src/content.ts";
import { PAY_SERVICE, PRICE } from "../prices.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another, in
// order. One failing leaves the rest to run.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

const REMIND = appCopy.booking.pay.remind;

const REMINDED = appCopy.booking.confirmed.tellsYou;

/** A booking with nothing to pay: the API books it at once, and the hold's poll finds it booked. */
async function bookedWithoutPaying(page: Page, hold: () => Hold): Promise<void> {
  await page.route("**/api/bookings", (route) =>
    route.fulfill({ status: 201, json: { hold_id: hold().id, checkout: null } }),
  );
  await page.route(/\/api\/holds\/[0-9a-f-]{36}$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ...hold(), state: "booked", visit_id: crypto.randomUUID() } })
      : route.fallback(),
  );
}

test("books and pays for a service visit through Razorpay Checkout", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await profileAs(page, { reminders: true });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: appCopy.booking.pay.title });
  await expect(pay.getByText(/^Held for \d:\d\d$/)).toBeVisible();
  await expect(pay.getByText(PRICE.service, { exact: true })).toBeVisible();
  // GST is nothing here, so the figure is said once, with no "incl. GST" repeating it.
  await expect(pay.getByText(/GST/)).toHaveCount(0);
  // The day picked is never tomorrow, so its window is outside the notice whatever the time of day.
  await expect(pay.getByText(FREE_UNTIL)).toBeVisible();
  // Checkout lists the ways to pay, so the sheet offers no choice Checkout would ignore.
  await expect(pay.getByRole("radiogroup")).toHaveCount(0);
  // Whoever the hold names: never the technician of the client's last visit (docs/decisions/0111).
  await expect(pay.getByText(/^\S+ never handles money\.$/)).toBeVisible();
  // Already switched on, so the sheet does not ask again.
  await expect(pay.getByRole("checkbox", { name: REMIND })).toHaveCount(0);
  // Booking agrees to no photograph consent, whatever the client decided.
  await expect(pay.getByText(/^By booking this visit/)).toHaveCount(0);

  await pay.getByRole("button", { name: PAY_SERVICE }).click();
  const confirmed = page.getByRole("dialog", { name: appCopy.booking.confirmed.label });
  await expect(confirmed.getByRole("status").getByText(REMINDED)).toBeVisible();
  await expect(confirmed.getByText(appCopy.booking.confirmed.paid, { exact: true })).toBeVisible();
  await expect(confirmed.getByText(PRICE.service)).toBeVisible();
  await page.getByRole("button", { name: appCopy.booking.confirmed.close }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("lets Checkout’s own window through, in front of the sheet", async ({ page }) => {
  await checkoutOnTop(page);
  await confirmedByRazorpay(page);
  await toPayment(page);
  await page.getByRole("button", { name: PAY_SERVICE }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText(appCopy.booking.confirmed.label)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __checkoutOnTop: boolean | null }).__checkoutOnTop)).toBe(
    true,
  );
});

test("confirms a visit a credit covers as a credit used, never as a payment", async ({ page }) => {
  const hold = await holdAs(page, { credit: { remaining: 2 } });
  await bookedWithoutPaying(page, hold);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: appCopy.booking.pay.titleFree, exact: true });
  await expect(pay.getByText(appCopy.booking.pay.credit.used)).toBeVisible();
  await pay.getByRole("button", { name: appCopy.booking.pay.confirm }).click();

  const confirmed = page.getByRole("dialog").getByRole("status");
  await expect(confirmed.getByText(appCopy.booking.confirmed.label)).toBeVisible();
  await expect(confirmed.getByText(appCopy.booking.pay.credit.used)).toBeVisible();
  await expect(confirmed.getByText("2 remaining")).toBeVisible();
  await expect(confirmed.getByText(appCopy.booking.confirmed.paid, { exact: true })).toHaveCount(0);
  await expect(confirmed.getByText(PRICE.service)).toHaveCount(0);
});

test("shows the price, and opens no Checkout, when the credit went on another booking in the meantime", async ({
  page,
}) => {
  await fakeCheckout(page, "paid");
  const hold = await holdAs(page, { credit: { remaining: 0 } });
  const checkout = { key_id: "rzp_test", order_id: "order_1", amount: 200000, currency: "INR", name: "Mane Man" };
  await page.route("**/api/bookings", (route) =>
    route.fulfill({
      status: 201,
      json: {
        hold_id: hold().id,
        checkout: { ...checkout, description: "Service visit", prefill: { name: "Rohit Malhotra", contact: "" } },
      },
    }),
  );
  await page.route(/\/api\/holds\/[0-9a-f-]{36}$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { ...hold(), credit: null } }) : route.fallback(),
  );
  await toPayment(page);
  await page
    .getByRole("dialog", { name: appCopy.booking.pay.titleFree, exact: true })
    .getByRole("button", { name: appCopy.booking.pay.confirm })
    .click();

  // Now there is a price to pay, the step is named for paying it.
  const pay = page.getByRole("dialog", { name: appCopy.booking.pay.title });
  await expect(pay.getByText(appCopy.booking.creditGone)).toBeVisible();
  await expect(pay.getByText(appCopy.booking.pay.credit.used)).toHaveCount(0);
  await expect(pay.getByRole("button", { name: PAY_SERVICE })).toBeVisible();
});

// A discount code at the pay step (docs/decisions/0108-discount-codes.md), which no board draws. The API prices the
// hold again; it is answered here, as the local database holds no code.
test("takes a discount code off the price at the pay step, says only that a wrong one does not apply, and takes it off", async ({
  page,
}) => {
  const hold = await holdAs(page, {});
  let applies = false;
  await page.route(/\/api\/holds\/[0-9a-f-]{36}\/discount-code$/, (route) => {
    if (route.request().method() === "DELETE") return route.fulfill({ json: hold() });
    if (!applies) {
      return route.fulfill({ status: 422, json: { error: { code: "code_not_applicable", request_id: "test" } } });
    }
    const list = { amount_ex_gst: 200_000, amount: 200_000, gst_percent: 0 };
    const discount = { code: "WEDDNG25", amount_ex_gst: 20_000, list_price: list };
    return route.fulfill({
      json: { ...hold(), price: { ...list, amount_ex_gst: 180_000, amount: 180_000 }, discount },
    });
  });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: appCopy.booking.pay.title });
  await pay.getByRole("button", { name: appCopy.booking.pay.code.open }).click();
  await pay.getByLabel(appCopy.booking.pay.code.label).fill("wrong1");
  await pay.getByRole("button", { name: appCopy.booking.pay.code.apply }).click();
  await expect(pay.getByRole("alert")).toHaveText("That code doesn’t apply to this visit.");

  applies = true;
  await pay.getByLabel(appCopy.booking.pay.code.label).fill("weddng25");
  await pay.getByRole("button", { name: appCopy.booking.pay.code.apply }).click();
  await expect(pay.getByText("Code WEDDNG25: Rs. 200 off")).toBeVisible();
  await expect(pay.getByRole("button", { name: "Pay Rs. 1,800" })).toBeVisible();
  await scanOf(page);

  await pay.getByRole("button", { name: appCopy.booking.pay.code.remove }).click();
  await expect(pay.getByRole("button", { name: PAY_SERVICE })).toBeVisible();
});

test("asks whether to remind the client on WhatsApp, and records it when they say yes", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await profileAs(page, { reminders: false });
  const switched: unknown[] = [];
  await page.route("**/api/consents/whatsapp_visits", (route) => {
    switched.push(route.request().postDataJSON());
    return route.fulfill({ json: { purpose: "whatsapp_visits", granted: true, since: new Date().toISOString() } });
  });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: appCopy.booking.pay.title });
  const remind = pay.getByRole("checkbox", { name: REMIND });
  await expect(remind).not.toBeChecked();
  await remind.check();
  await pay.getByRole("button", { name: PAY_SERVICE }).click();

  await expect(page.getByRole("dialog").getByRole("status").getByText(REMINDED)).toBeVisible();
  // Kept as given on the booking sheet (docs/decisions/0094-where-a-consent-was-given.md).
  expect(switched).toEqual([{ granted: true, source: "app_booking" }]);
});

test("promises no reminder the client has not agreed to", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await profileAs(page, { reminders: false });
  await toPayment(page);
  await page.getByRole("button", { name: PAY_SERVICE }).click();
  const confirmed = page.getByRole("dialog").getByRole("status");
  await expect(confirmed.getByText(appCopy.booking.confirmed.label)).toBeVisible();
  await expect(confirmed.getByText(REMINDED)).toHaveCount(0);
});
