// Moving and cancelling a visit in the app (boards C7 and C8), for the two clients of e2e/app/changing.ts,
// against the local mm-api, whose FSM and payments are stubs, with Razorpay faked (e2e/app/checkout-fakes.ts).
// The consequence shows before the client confirms.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { changingClients } from "./changing.ts";
import { confirmedByRazorpay, fakeCheckout, noRealCheckout } from "./checkout-fakes.ts";
import { continueToPayment } from "./picking.ts";
import { logIn } from "./signed-in.ts";

// Each client's visit is moved, then cancelled, so these run one after another.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

async function reschedule(page: Page, mobile: string) {
  await logIn(page, mobile);
  await page.getByRole("button", { name: "Reschedule" }).click();
  return page.getByRole("dialog", { name: /^Move \w+day's visit$/ });
}

/** Through the date and window steps, to the pay step. */
async function pickAnother(page: Page, which: "first" | "last"): Promise<void> {
  const dates = page.getByRole("dialog", { name: "Pick a date" }).getByRole("radio").and(page.locator(":enabled"));
  await (which === "first" ? dates.first() : dates.last()).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await continueToPayment(page);
}

// Board C1's Prepaid, on a visit paid for ahead; and the visit opens its own page, with the same ways to change it
// as Home has (CLI-26). Read before the tests below move and cancel it.
test("C1: a paid visit is marked Prepaid, and opens with Reschedule", async ({ page }) => {
  await logIn(page, changingClients().free.mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  const card = page.getByRole("main").getByRole("link").first();
  await expect(card).toContainText("Prepaid");
  await card.click();
  await page.getByRole("button", { name: "Reschedule" }).click();
  await expect(page.getByRole("dialog", { name: /^Move \w+day's visit$/ })).toBeVisible();
});

test("C7: a visit more than 24 hours out moves for free, its payment carried over", async ({ page }) => {
  await confirmedByRazorpay(page);
  const sheet = await reschedule(page, changingClients().free.mobile);
  await expect(sheet.getByText("Free to move. Your Rs. 2,000 carries over.")).toBeVisible();
  await scan(page);
  await sheet.getByRole("button", { name: "Pick a new date" }).click();
  // The furthest day, so the visit stays more than 24 hours out for the cancel below.
  await pickAnother(page, "last");
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("Service visit · moved")).toBeVisible();
  await expect(pay.getByText("Free", { exact: true })).toBeVisible();
  await expect(pay.getByText("Your Rs. 2,000 carries over.")).toBeVisible();
  // This client has decided neither photograph consent, and a move agrees to nothing (ADR 0080).
  await expect(pay.getByText(/^By booking this visit/)).toHaveCount(0);
  await pay.getByRole("button", { name: "Confirm the move" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Moved")).toBeVisible();
});

test("C8: cancelling more than 24 hours out gives the payment back in full", async ({ page }) => {
  const sheet = await reschedule(page, changingClients().free.mobile);
  await sheet.getByRole("button", { name: "Cancel the visit instead" }).click();
  const cancel = page.getByRole("dialog", { name: /^Cancel \w+day's visit$/ });
  await expect(cancel.getByText("Rs. 2,000 back to your UPI in 5 to 7 working days.")).toBeVisible();
  await scan(page);
  await cancel.getByRole("button", { name: "Cancel visit" }).click();
  const done = page.getByRole("dialog").getByRole("status");
  await expect(done.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(done.getByText(/^\w+day's visit is cancelled\.$/)).toBeVisible();
  await done.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Reschedule" })).toBeHidden();
});

test("C8 inside 24 hours shows the charge before anything is cancelled, and Keep it keeps the visit", async ({
  page,
}) => {
  const sheet = await reschedule(page, changingClients().late.mobile);
  await sheet.getByRole("button", { name: "Cancel the visit instead" }).click();
  const cancel = page.getByRole("dialog", { name: /^Cancel \w+day's visit$/ });
  await expect(cancel.getByText("Charged. The Rs. 2,000 is not refunded.")).toBeVisible();
  await expect(cancel.getByRole("button", { name: "Cancel and accept charge" })).toBeVisible();
  await cancel.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Reschedule" })).toBeVisible();
});

test("C7 inside 24 hours: a service visit's move is charged, and the new visit is paid separately", async ({
  page,
}) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  const sheet = await reschedule(page, changingClients().late.mobile);
  await expect(
    sheet.getByText("Charged. The Rs. 2,000 is not refunded and the new visit is paid separately."),
  ).toBeVisible();
  await scan(page);
  await sheet.getByRole("button", { name: "Move and accept charge" }).click();
  await pickAnother(page, "first");
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("Service visit", { exact: true })).toBeVisible();
  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Moved")).toBeVisible();
});
