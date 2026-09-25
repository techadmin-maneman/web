// Razorpay in the app's browser tests, against the local mm-api, whose payments are a stub. Checkout's script is
// replaced by one that pays or fails at once, and Razorpay's confirmation, which reaches only a real webhook, is
// shown by answering the hold's poll as booked.

import type { Page } from "@playwright/test";

/**
 * No real Razorpay in a browser test. The pay step loads Checkout as it opens, and the real script pulls in more of
 * Razorpay's than the app's policy allows (its risk-detection bundle, inline styles), which failed whichever test
 * happened to let it arrive before it ended. Registered before a test's own fake, which therefore answers first.
 */
export async function noRealCheckout(page: Page): Promise<void> {
  await page.route(/^https:\/\/(checkout|cdn)\.razorpay\.com\//, (route) => route.abort());
}

/** Checkout that pays, or fails, as soon as it opens. */
export async function fakeCheckout(page: Page, outcome: "paid" | "failed"): Promise<void> {
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
 * Checkout that paints a window of its own across the page, as Razorpay's iframe does, and records whether the page
 * let it through: `window.__checkoutOnTop`. A sheet left open with showModal() sits in the browser's top layer, above
 * every z-index and with the rest of the page inert, so Checkout would be drawn under it and take no taps.
 */
export async function checkoutOnTop(page: Page): Promise<void> {
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.__checkoutOnTop = null;
      window.Razorpay = function (options) {
        this.on = () => {};
        this.open = () => {
          const own = document.createElement("div");
          own.id = "fake-checkout";
          own.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#000";
          document.body.append(own);
          setTimeout(() => {
            const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
            window.__checkoutOnTop = top === own;
            own.remove();
            options.handler({ razorpay_payment_id: "pay_fake" });
          }, 50);
        };
      };`,
    }),
  );
}

/**
 * The hold's poll answered as Razorpay's webhook and FSM would leave it: paid and booked. The hold is the one the
 * page was given; only the browser resolves app.localhost, so the test cannot fetch it again itself.
 */
export async function confirmedByRazorpay(page: Page): Promise<void> {
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
