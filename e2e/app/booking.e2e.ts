// Booking in the app (boards C2 to C6) for the fitted client of
// e2e/app/fitted.ts, against the local mm-api, whose payments are a stub.
// Razorpay's Checkout script is replaced by one that pays or fails at once,
// and Razorpay's confirmation, which reaches only a real webhook, is shown by
// answering the hold's poll as booked.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another.
test.describe.configure({ mode: "serial" });

/** Checkout that pays, or fails, as soon as it opens. */
async function fakeCheckout(page: Page, outcome: "paid" | "failed"): Promise<void> {
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.Razorpay = function (options) {
        const failed = [];
        this.on = (event, handler) => { if (event === "payment.failed") failed.push(handler); };
        this.open = () => setTimeout(() => ${
          outcome === "paid"
            ? 'options.handler({ razorpay_payment_id: "pay_fake" })'
            : "failed.forEach((handler) => handler({}))"
        }, 50);
      };`,
    }),
  );
}

/**
 * The hold's poll answered as Razorpay's webhook and FSM would leave it: paid and booked. The hold is the one the
 * page was given; only the browser resolves app.localhost, so the test cannot fetch it again itself.
 */
async function confirmedByRazorpay(page: Page): Promise<void> {
  let hold: Record<string, unknown> = {};
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.url().endsWith("/api/holds")) {
      void response.json().then((body: Record<string, unknown>) => {
        hold = body;
      });
    }
  });
  await page.route(/\/api\/holds\/[0-9a-f-]{36}$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ...hold, state: "booked", paid: true, visit_id: crypto.randomUUID() } })
      : route.fallback(),
  );
}

async function toPayment(page: Page): Promise<void> {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  await page.getByRole("button", { name: "Book your next visit" }).click();
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  await expect(sheet.getByText("Step 1 of 3")).toBeVisible();
  await sheet.getByRole("radio").and(page.locator(":enabled")).first().click();
  await sheet.getByRole("button", { name: "Continue" }).click();
  const windows = page.getByRole("dialog", { name: "Pick a window" });
  await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
  await windows.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("dialog", { name: "Pay and confirm" })).toBeVisible();
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

test("says so when the payment fails, with the hold still counting", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const failed = page.getByRole("dialog").getByRole("alert");
  await expect(failed.getByText("The payment did not go through.")).toBeVisible();
  await expect(failed.getByText(/^Slot held \d:\d\d more\.$/)).toBeVisible();
  await expect(failed.getByRole("button", { name: "Another method" })).toBeVisible();
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
