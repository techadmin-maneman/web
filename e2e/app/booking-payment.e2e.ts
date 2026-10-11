// Booking in the app for the fitted client with an address of
// e2e/app/booker.ts, against the local mm-api, with Razorpay faked
// (e2e/app/checkout-fakes.ts): the address asked for first when there is none
// (ADR 0079), what booking also agrees to on the pay step (ADR 0080), and the
// service booked: picked first where its kind offers more than one, the one
// the app offers chosen (ADR 0085, ADR 0086).

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  checkoutLeftOpen,
  checkoutOpened,
  closedCheckout,
  confirmedByRazorpay,
  fakeCheckout,
  noRealCheckout,
  paidInCheckout,
  refundedAfterPaying,
} from "./checkout-fakes.ts";
import { PORTS } from "../../scripts/lib/local-stack.ts";
import { windowSpan, type BookingWindow } from "../../src/config/scheduling.ts";
import { continueToPayment, TAKEN } from "./picking.ts";
import { toPayment, toWindows, holdAs } from "./booking-fixtures.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another, in
// order. One failing leaves the rest to run.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

const CHECKOUT = "https://checkout.razorpay.com/v1/checkout.js";

/** Every hold the page lets go of. */
/** Waits until the hold's count has moved on a second, which is time passing with the sheet still up. */
async function ticked(sheet: Locator): Promise<void> {
  const count = sheet.getByText(/^Held for \d:\d\d more\.$/);
  const shown = (await count.textContent()) ?? "";
  await expect(count).not.toHaveText(shown);
}

function releases(page: Page): string[] {
  const released: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE" && /\/api\/holds\/[0-9a-f-]{36}$/.test(request.url())) {
      released.push(request.url());
    }
  });
  return released;
}

test("says so when the payment fails, with the hold counting outside the alert", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const sheet = page.getByRole("dialog", { name: "The payment didn’t go through." });
  const alert = sheet.getByRole("alert");
  await expect(alert).toContainText("The payment didn’t go through.");
  await expect(sheet.getByText(/^Held for \d:\d\d more\.$/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();
  // A screen reader reads an alert again whenever it changes: the ticking count is kept out of it.
  const said = await alert.textContent();
  await ticked(sheet);
  expect(await alert.textContent()).toBe(said);
});

test("keeps the sheet, and the hold, when Checkout fails the moment it opens", async ({ page }) => {
  await page.route(CHECKOUT, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.Razorpay = function () {
        const failed = [];
        this.on = (event, handler) => { if (event === "payment.failed") failed.push(handler); };
        this.open = () => failed.forEach((handler) => handler({}));
      };`,
    }),
  );
  await toPayment(page);
  const released = releases(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const failed = page.getByRole("dialog").getByText("The payment didn’t go through.");
  await expect(failed).toBeVisible();
  await ticked(page.getByRole("dialog"));
  await expect(failed).toBeVisible();
  expect(released).toEqual([]);
});

test("loads Checkout as the pay step opens, not after the tap", async ({ page }) => {
  await fakeCheckout(page, "paid");
  const loaded = page.waitForRequest(CHECKOUT);
  await toPayment(page);
  await loaded;
});

test("says the payment failed when Checkout never loads, and keeps the sheet up while it waits", async ({ page }) => {
  await page.clock.install();
  // Checkout's script is asked for and never arrives.
  await page.route(CHECKOUT, () => new Promise<void>(() => undefined));
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  // The order is made first; only then is the sheet waiting on Checkout alone.
  const ordered = page.waitForResponse("**/api/bookings");
  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await ordered;
  await expect(pay).toBeVisible();
  await expect(pay.getByRole("button", { name: "Pay Rs. 2,000" })).toBeDisabled();
  const failed = page.getByRole("dialog", { name: "The payment didn’t go through." });
  // Checkout is given up on twenty seconds after it was last asked for. On a busy machine the pay step's own ask can
  // lapse before the tap, which asks again only once the order is in, after a single jump of the clock (1 October
  // 2026): so the clock moves on until the sheet has given up.
  await expect(async () => {
    await page.clock.fastForward("00:20");
    await expect(failed).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(failed.getByText(/^Held for \d:\d\d more\.$/)).toBeVisible();
});

test("starts one payment, and one order, when the failed step is tapped twice", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const failed = page.getByRole("dialog", { name: "The payment didn’t go through." });
  await expect(failed).toBeVisible();

  // Every order the API hands back, so two of them would be two ways to pay for one hold.
  const orders: string[] = [];
  page.on("response", (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/bookings")) return;
    void response.json().then((body: { checkout: { order_id: string } | null }) => {
      if (body.checkout !== null) orders.push(body.checkout.order_id);
    });
  });
  /*
   * The round trip is held open, so the second tap lands inside it, where an anxious client's
   * lands; and a second request, if one comes, is let go together with the first. Against the
   * local API the order is made in microseconds, while in production it is a call to Razorpay
   * and the two taps arrive inside it. Letting them go together is that, made certain.
   */
  let asked = 0;
  const waiting: (() => void)[] = [];
  const letGo = () => {
    for (const release of waiting.splice(0)) release();
  };
  await page.route("**/api/bookings", async (route) => {
    asked += 1;
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= 2) letGo();
      else setTimeout(letGo, 2_000);
    });
    await route.continue();
  });

  const tryAgain = failed.getByRole("button", { name: "Try again" });
  await tryAgain.click();
  // Forced, because the tap this guards against is one the client makes whether the button takes it or not.
  await tryAgain.click({ force: true });
  const liveWhileBusy = await tryAgain.isEnabled();

  await expect.poll(() => orders.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // Every order asked for has come back: a second one is let go with the first (e2e/app/one-tap.ts).
  await expect.poll(() => orders.length).toBe(asked);
  expect({ asked, distinctOrders: new Set(orders).size, liveWhileBusy }).toEqual({
    asked: 1,
    distinctOrders: 1,
    liveWhileBusy: false,
  });
});

/** "20261013T063000Z", as a calendar link writes an instant. */
const stamp = (instant: Date): string => instant.toISOString().replace(/[-:]|\.\d{3}/g, "");

test("offers the visit just booked to the client's calendar, at the window held", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  const held = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/holds" && response.ok(),
  );
  await toPayment(page);
  const hold = (await (await held).json()) as { date: string; window: BookingWindow };
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const confirmed = page.getByRole("dialog", { name: "Confirmed" });
  await expect(confirmed).toBeVisible({ timeout: 15_000 });

  const { start, end } = windowSpan(hold.date, hold.window);
  const google = new URL((await confirmed.getByRole("link", { name: "Google Calendar" }).getAttribute("href")) ?? "");
  expect(google.searchParams.get("dates")).toBe(`${stamp(start)}/${stamp(end)}`);
  const file = confirmed.getByRole("link", { name: "Apple or Outlook" });
  await expect(file).toHaveAttribute("download", "mane-man-visit.ics");
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
  const windows = page.getByRole("dialog", { name: "Pick a time" });
  await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
  await windows.getByRole("button", { name: "Continue to payment" }).click();
  await expect(windows.getByRole("alert")).toHaveText(TAKEN);
  // Nothing is chosen any more: the day's windows have been asked for again, and the client picks from those.
  await expect(windows.getByRole("button", { name: "Continue to payment" })).toBeDisabled();

  await continueToPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
});

test("keeps the window picked while the day's windows are still being asked for again", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  let taken = false;
  await page.route("**/api/holds", (route) => {
    if (taken || route.request().method() !== "POST") return route.fallback();
    taken = true;
    return route.fulfill({ status: 409, json: { error: { code: "taken", request_id: "e2e" } } });
  });
  await toWindows(page);
  // The windows asked for again after the refusal come back slowly, after the client has picked.
  let release: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  let gone = "";
  await page.route("**/api/availability**", async (route) => {
    if (!taken) return route.fallback();
    await answered;
    // The window that went is full in the fresh answer, as it would be.
    const asked = new URL(route.request().url());
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}${asked.pathname}${asked.search}`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    const body = (await answer.json()) as { days: { windows: { window: string; open: boolean }[] }[] };
    for (const day of body.days) for (const each of day.windows) if (each.window === gone) each.open = false;
    return route.fulfill({ response: answer, json: body });
  });
  const windows = page.getByRole("dialog", { name: "Pick a time" });
  const open = windows.getByRole("radio").and(page.locator(":enabled"));
  /** A window's name, "Morning", from its radio's accessible name. */
  const nameOf = async (radio: Locator) => /radio "(\w+)/.exec(await radio.ariaSnapshot())?.[1] ?? "";
  const goneName = await nameOf(open.first());
  const pickedName = await nameOf(open.last());
  gone = goneName.toLowerCase();
  await open.first().click();
  await windows.getByRole("button", { name: "Continue to payment" }).click();
  await expect(windows.getByRole("alert")).toHaveText(TAKEN);
  const picked = windows.getByRole("radio", { name: new RegExp(`^${pickedName}`) });
  await picked.click();
  release();
  await expect(windows.getByRole("radio", { name: new RegExp(`^${goneName}`) })).toBeDisabled();
  await expect(picked).toBeChecked();
  await expect(windows.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
});

test("fetches Home again when the sheet is closed after paying, before the booking is confirmed", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const confirming = page.getByRole("dialog", { name: "Confirming your visit." });
  await expect(confirming).toBeVisible();
  const home = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/me", { timeout: 5_000 });
  await confirming.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await home;
});

// A step that ends with a Close of its own showed the sheet's as well, two of one name.
test("shows one Close, its own, when a paid visit could not be booked", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await refundedAfterPaying(page);
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const refunded = page.getByRole("dialog", {
    name: "We couldn’t book that visit, so we’re refunding your payment in full.",
  });
  await expect(refunded).toBeVisible();
  await expect(refunded.getByRole("button", { name: "Close" })).toHaveCount(1);
  await refunded.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("lets a lapsed hold go the moment the phone sees it lapse, and picks again", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await page.clock.install();
  await toPayment(page);
  const released = page.waitForRequest(
    (request) => request.method() === "DELETE" && /\/api\/holds\/[0-9a-f-]{36}$/.test(request.url()),
    { timeout: 5_000 },
  );
  await page.clock.fastForward("11:00");
  const expired = page.getByRole("dialog", { name: "That time has been released." });
  await expect(expired).toBeVisible();
  await released;
  await expired.getByRole("button", { name: "Pick again" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
});

// A payment Razorpay took in time keeps the hold (ADR 0068): when the phone sees the time end, it asks, and says
// the payment is in rather than that the slot has gone, and lets nothing go.
test("says the payment is in, and lets nothing go, when the time ends on a paid hold", async ({ page }) => {
  await page.clock.install();
  const hold = await holdAs(page, {});
  const released = releases(page);
  await page.route(/\/api\/holds\/[0-9a-f-]{36}$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ...hold(), state: "held", paid: true } })
      : route.fallback(),
  );
  await toPayment(page);
  await page.clock.fastForward("11:00");
  await expect(page.getByRole("dialog", { name: "Your payment is in. We are booking your visit." })).toBeVisible();
  expect(released).toEqual([]);
});

/** The last moment a payment counts as in time, on the last hold the API gave the page. */
function lastPayBy(page: Page): () => string {
  let payBy = "";
  page.on("response", (response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/holds") || !response.ok()) return;
    void response.json().then((hold: { pay_by: string }) => {
      payBy = hold.pay_by;
    });
  });
  return () => payBy;
}

// While Checkout is open the phone lets nothing go: a payment made in the grace after the countdown books.
test("keeps the hold while Checkout is open past the countdown, and books the payment made in it", async ({ page }) => {
  await checkoutLeftOpen(page);
  await confirmedByRazorpay(page);
  await page.clock.install();
  const payBy = lastPayBy(page);
  await toPayment(page);
  const released = releases(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const opened = await checkoutOpened(page);
  // Checkout takes a payment until the grace after the countdown ends, and no longer.
  expect(Math.abs(opened.openedAt + opened.timeout * 1000 - Date.parse(payBy()))).toBeLessThan(5_000);
  await page.clock.fastForward("11:00");
  await paidInCheckout(page);
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
  expect(released).toEqual([]);
});

test("says the slot has gone back, and lets the API let it go, when Checkout closes after the countdown", async ({
  page,
}) => {
  await checkoutLeftOpen(page);
  await page.clock.install();
  await toPayment(page);
  const released = releases(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await checkoutOpened(page);
  await page.clock.fastForward("11:00");
  await closedCheckout(page);
  await expect(page.getByRole("dialog", { name: "That time has been released." })).toBeVisible();
  expect(released).toEqual([]);
});

test("counts the hold on the API's clock, however far out the phone's is", async ({ page }) => {
  await fakeCheckout(page, "paid");
  // Eleven minutes fast: on the phone's own clock, the ten-minute hold would have lapsed before it began.
  await page.clock.install({ time: Date.now() + 11 * 60_000 });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText(/^Held for (10:00|9:[45]\d)$/)).toBeVisible();
  await expect(pay.getByRole("button", { name: "Pay Rs. 2,000" })).toBeEnabled();
});

test("says, once, when a minute of the hold is left", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await page.clock.install();
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  const told = pay.getByRole("status").filter({ hasText: "One minute left" });
  await expect(told).toHaveCount(0);
  await page.clock.fastForward("09:05");
  await expect(told).toHaveText("One minute left to pay. Then the time is released.");
});
