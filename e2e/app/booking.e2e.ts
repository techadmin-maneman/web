// Booking in the app (boards C2 to C6) for the fitted client of
// e2e/app/fitted.ts, against the local mm-api, with Razorpay faked
// (e2e/app/checkout-fakes.ts).

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { checkoutOnTop, confirmedByRazorpay, fakeCheckout } from "./checkout-fakes.ts";
import { fittedClient } from "./fitted.ts";
import { continueToPayment, TAKEN } from "./picking.ts";
import { logIn } from "./signed-in.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another.
test.describe.configure({ mode: "serial" });

/** Logs in and picks the first free day, as far as the window step. */
async function toWindows(page: Page): Promise<void> {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  await page.getByRole("button", { name: "Book your next visit" }).click();
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  await expect(sheet.getByText("Step 1 of 3")).toBeVisible();
  await sheet.getByRole("radio").and(page.locator(":enabled")).first().click();
  await sheet.getByRole("button", { name: "Continue" }).click();
}

async function toPayment(page: Page): Promise<void> {
  await toWindows(page);
  await continueToPayment(page);
}

test("books and pays for a service visit through Razorpay Checkout", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText(/^Slot held \d:\d\d$/)).toBeVisible();
  await expect(pay.getByText("Rs. 2,000", { exact: true })).toBeVisible();
  await expect(pay.getByText("Rs. 2,000 incl. GST")).toBeVisible();
  await expect(pay.getByText(/^Free to move until .+\. After that it is charged\.$/)).toBeVisible();
  await expect(pay.getByRole("radio", { name: "UPI · any app" })).toHaveAttribute("aria-checked", "true");
  await expect(pay.getByText("Imran never handles money.")).toBeVisible();

  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const confirmed = page.getByRole("dialog").getByRole("status");
  await expect(confirmed.getByText("Confirmed")).toBeVisible();
  await expect(confirmed.getByText("Imran messages you the day before.")).toBeVisible();
  await expect(confirmed.getByText("Rs. 2,000")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("lets Checkout's own window through, in front of the sheet", async ({ page }) => {
  await checkoutOnTop(page);
  await confirmedByRazorpay(page);
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __checkoutOnTop: boolean | null }).__checkoutOnTop)).toBe(
    true,
  );
});

test("says so when the payment fails, with the hold still counting", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const failed = page.getByRole("dialog").getByRole("alert");
  await expect(failed.getByText("The payment did not go through.")).toBeVisible();
  await expect(failed.getByText(/^Slot held \d:\d\d more\.$/)).toBeVisible();
  await expect(failed.getByRole("button", { name: "Another method" })).toBeVisible();
});

test("picks another window when one has just gone, and pays for that one", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  // The first window goes to another client between the sheet offering it and the hold.
  let met = false;
  await page.route("**/api/holds", (route) => {
    if (met || route.request().method() !== "POST") return route.fallback();
    met = true;
    return route.fulfill({ status: 409, json: { error: { code: "taken", request_id: "e2e" } } });
  });
  await toWindows(page);
  const windows = page.getByRole("dialog", { name: "Pick a window" });
  await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
  await windows.getByRole("button", { name: "Continue to payment" }).click();
  await expect(windows.getByRole("alert")).toHaveText(TAKEN);
  // Nothing is chosen any more: the day's windows have been asked for again, and the client picks from those.
  await expect(windows.getByRole("button", { name: "Continue to payment" })).toBeDisabled();

  await continueToPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
});

test("lets a lapsed hold go, and picks again", async ({ page }) => {
  await page.clock.install();
  await toPayment(page);
  await page.clock.fastForward("11:00");
  const expired = page.getByRole("dialog").getByRole("alert");
  await expect(expired.getByText("That slot has gone back.")).toBeVisible();
  await expired.getByRole("button", { name: "Pick again" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
});

test("each booking step meets WCAG 2.2 AA", async ({ page }) => {
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  };
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  await page.getByRole("button", { name: "Book your next visit" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
  await scan();
  await page.getByRole("dialog").getByRole("radio").and(page.locator(":enabled")).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a window" })).toBeVisible();
  await scan();
  await page.getByRole("dialog").getByRole("radio").and(page.locator(":enabled")).first().click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("dialog", { name: "Pay and confirm" })).toBeVisible();
  await scan();
});
