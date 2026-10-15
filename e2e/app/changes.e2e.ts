// Moving and cancelling a visit in the app, for the two clients of e2e/app/changing.ts,
// against the local mm-api, whose FSM and payments are stubs, with Razorpay faked (e2e/app/checkout-fakes.ts).
// The consequence shows before the client confirms.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { changingClients } from "./changing.ts";
import { holdOpen } from "./one-tap.ts";
import { confirmedByRazorpay, fakeCheckout, noRealCheckout } from "./checkout-fakes.ts";
import { continueToPayment } from "./picking.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";
import { PRICE } from "../prices.ts";
import { PAY_SERVICE } from "./booking-fixtures.ts";

// Each client's visit is moved, then cancelled, so these run one after another, in order. One failing leaves the
// rest to run.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

async function scan(page: Page): Promise<void> {
  expect(await axeViolations(page)).toEqual([]);
}

async function reschedule(page: Page, mobile: string) {
  await logIn(page, mobile);
  await page.getByRole("button", { name: appCopy.home.reschedule }).click();
  return page.getByRole("dialog", { name: /^Move \w+day’s visit$/ });
}

/** Through the date and window steps, to the pay step. */
async function pickAnother(page: Page, which: "first" | "last"): Promise<void> {
  const dates = page
    .getByRole("dialog", { name: appCopy.booking.date.title })
    .getByRole("radio")
    .and(page.locator(":enabled"));
  await (which === "first" ? dates.first() : dates.last()).click();
  await page.getByRole("button", { name: appCopy.booking.date.continue }).click();
  await continueToPayment(page);
}

// Visits' Prepaid, on a visit paid for ahead; and the visit opens its own page, with the same ways to change it
// as Home has. Read before the tests below move and cancel it.
test("C1: a paid visit is marked Prepaid, and opens with Reschedule", async ({ page }) => {
  await logIn(page, changingClients().free.mobile);
  await page.getByRole("navigation").getByRole("link", { name: appCopy.titles.visits }).click();
  const card = page.getByRole("main").getByRole("link").first();
  await expect(card).toContainText(appCopy.visits.prepaid);
  await card.click();
  await page.getByRole("button", { name: appCopy.home.reschedule }).click();
  await expect(page.getByRole("dialog", { name: /^Move \w+day’s visit$/ })).toBeVisible();
});

test("C7: a visit more than 24 hours out moves for free, its payment carried over", async ({ page }) => {
  await confirmedByRazorpay(page);
  const sheet = await reschedule(page, changingClients().free.mobile);
  await expect(sheet.getByText(appCopy.change.move.free(PRICE.service))).toBeVisible();
  await scan(page);
  await sheet.getByRole("button", { name: appCopy.change.move.pick }).click();
  // The furthest day, so the visit stays more than 24 hours out for the cancel below.
  await pickAnother(page, "last");
  // Nothing to pay for a free move, so nothing calls it a payment.
  const pay = page.getByRole("dialog", { name: appCopy.booking.pay.titleFree, exact: true });
  await expect(pay.getByText("Service visit · moved")).toBeVisible();
  await expect(pay.getByText(appCopy.booking.pay.free, { exact: true })).toBeVisible();
  await expect(pay.getByText(appCopy.change.move.carriesOver(PRICE.service))).toBeVisible();
  // This client has decided neither photograph consent, and a move agrees to nothing (ADR 0080).
  await expect(pay.getByText(/^By booking this visit/)).toHaveCount(0);
  await pay.getByRole("button", { name: appCopy.change.confirmMove }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText(appCopy.change.moved)).toBeVisible();
});

test("C8: cancelling more than 24 hours out, from the visit’s own page, gives the payment back in full", async ({
  page,
}) => {
  await logIn(page, changingClients().free.mobile);
  await page.getByRole("navigation").getByRole("link", { name: appCopy.titles.visits }).click();
  await page.getByRole("main").getByRole("link").first().click();
  await page.getByRole("button", { name: appCopy.home.reschedule }).click();
  const sheet = page.getByRole("dialog", { name: /^Move \w+day’s visit$/ });
  await sheet.getByRole("button", { name: appCopy.change.move.cancelInstead }).click();
  const cancel = page.getByRole("dialog", { name: /^Cancel \w+day’s visit$/ });
  await expect(cancel.getByText(appCopy.change.cancel.refund(PRICE.service, "UPI"))).toBeVisible();
  await scan(page);
  // Two taps, the second inside the first's round trip, cancel once (e2e/app/one-tap.ts).
  const held = await holdOpen(page, "**/api/appointments/*/cancel");
  const confirm = cancel.getByRole("button", { name: appCopy.change.cancel.confirm });
  await confirm.click();
  await confirm.click({ force: true });
  const done = page.getByRole("dialog").getByRole("status");
  await expect(done.getByText(appCopy.change.cancel.done, { exact: true })).toBeVisible();
  await expect(done.getByText(/^\w+day’s visit is cancelled\.$/)).toBeVisible();
  expect(held.asked()).toBe(1);
  await done.getByRole("button", { name: appCopy.change.cancel.close }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  // Nothing is left to change on the visit's own page, which goes back to the list.
  await expect(page).toHaveURL(/\/visits$/);
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toBeHidden();
});

test("C8 inside 24 hours shows the charge before anything is cancelled, and Keep it keeps the visit", async ({
  page,
}) => {
  const sheet = await reschedule(page, changingClients().late.mobile);
  await sheet.getByRole("button", { name: appCopy.change.move.cancelInstead }).click();
  const cancel = page.getByRole("dialog", { name: /^Cancel \w+day’s visit$/ });
  await expect(cancel.getByText(appCopy.change.cancel.charged(PRICE.service))).toBeVisible();
  await expect(cancel.getByRole("button", { name: appCopy.change.cancel.accept })).toBeVisible();
  await cancel.getByRole("button", { name: appCopy.change.cancel.keep }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toBeVisible();
});

test("C7 inside 24 hours: a service visit’s move is charged, and the new visit is paid separately", async ({
  page,
}) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  const sheet = await reschedule(page, changingClients().late.mobile);
  await expect(sheet.getByText(appCopy.change.move.charged(PRICE.service))).toBeVisible();
  await scan(page);
  await sheet.getByRole("button", { name: appCopy.change.move.accept }).click();
  await pickAnother(page, "first");
  const pay = page.getByRole("dialog", { name: appCopy.booking.pay.title });
  await expect(pay.getByText(appCopy.VISIT_TYPES.service, { exact: true })).toBeVisible();
  await pay.getByRole("button", { name: PAY_SERVICE }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText(appCopy.change.moved)).toBeVisible();
});
