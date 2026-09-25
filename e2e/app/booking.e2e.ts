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

const CHECKOUT = "https://checkout.razorpay.com/v1/checkout.js";
const REMIND = "Remind me on WhatsApp the day before";
const REMINDED = "Imran messages you the day before.";
/** A first fit and its late fee once GST applies, as it will in production (on staging GST is nothing). */
const FIRST_FIT = { amount_ex_gst: 3000000, amount: 3540000, gst_percent: 18 };
const LATE_FEE = { amount_ex_gst: 400000, amount: 472000, gst_percent: 18 };
const LATE_FEE_LINE = "Moving inside 24 hours costs Rs. 4,000 (Rs. 4,720 incl. GST). The balance carries over.";

type Hold = Record<string, unknown>;

/** Opens the booking sheet from Visits. */
async function openSheet(page: Page): Promise<void> {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  await page.getByRole("button", { name: "Book your next visit" }).click();
}

/** Logs in and picks the first free day, as far as the window step. */
async function toWindows(page: Page): Promise<void> {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  await expect(sheet.getByText("Step 1 of 3")).toBeVisible();
  await sheet.getByRole("radio").and(page.locator(":enabled")).first().click();
  await sheet.getByRole("button", { name: "Continue" }).click();
}

async function toPayment(page: Page): Promise<void> {
  await toWindows(page);
  await continueToPayment(page);
}

/**
 * Whether the client has switched on WhatsApp about their visits, as their profile answers it. The fitted client
 * is shared by every suite, so each test here says which it needs rather than depending on another's switch. Only
 * the browser resolves app.localhost, so the profile is answered whole rather than fetched and changed.
 */
async function remindersAre(page: Page, granted: boolean): Promise<void> {
  const purposes = ["photos_own_record", "photos_referral_cards", "photos_marketing", "whatsapp_visits"];
  const consents = purposes.map((purpose) => {
    const given = granted && purpose === "whatsapp_visits";
    return { purpose, granted: given, since: given ? new Date().toISOString() : null };
  });
  await page.route("**/api/profile", (route) =>
    route.fulfill({
      json: {
        name: "Rohit Malhotra",
        mobile: "+91 98xxx x4417",
        address: null,
        consents,
        number_change: null,
        deletion: null,
      },
    }),
  );
}

/**
 * A hold for the day and window the sheet asked for, on `terms` of the test's choosing: a first fit, or one a
 * credit covers. It is answered in the API's place, so nothing is held; returns the hold as the page received it.
 */
async function holdAs(page: Page, terms: Hold): Promise<() => Hold> {
  let last: Hold = {};
  await page.route("**/api/holds", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const asked = route.request().postDataJSON() as { type: string; date: string; window: string };
    const now = Date.now();
    last = {
      id: crypto.randomUUID(),
      type: asked.type,
      date: asked.date,
      window: asked.window,
      starts_at: `${asked.date}T06:30:00.000Z`,
      ends_at: `${asked.date}T10:30:00.000Z`,
      technician: { name: "Imran Qureshi", initials: "IQ" },
      price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
      late_fee: null,
      free_until: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      state: "held",
      paid: false,
      visit_id: null,
      moves_visit_id: null,
      credit: null,
      ...terms,
    };
    return route.fulfill({ status: 201, json: last });
  });
  return () => last;
}

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

/** Every hold the page lets go of. */
function releases(page: Page): string[] {
  const released: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE" && /\/api\/holds\/[0-9a-f-]{36}$/.test(request.url())) {
      released.push(request.url());
    }
  });
  return released;
}

test("books and pays for a service visit through Razorpay Checkout", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await remindersAre(page, true);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText(/^Slot held \d:\d\d$/)).toBeVisible();
  await expect(pay.getByText("Rs. 2,000", { exact: true })).toBeVisible();
  await expect(pay.getByText("Rs. 2,000 incl. GST")).toBeVisible();
  await expect(pay.getByText(/^Free to move until .+\. After that it is charged\.$/)).toBeVisible();
  await expect(pay.getByRole("radio", { name: "UPI · any app" })).toBeChecked();
  await expect(pay.getByText("Imran never handles money.")).toBeVisible();
  // Already switched on, so the sheet does not ask again.
  await expect(pay.getByRole("checkbox", { name: REMIND })).toHaveCount(0);

  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const confirmed = page.getByRole("dialog", { name: "Confirmed" });
  await expect(confirmed.getByRole("status").getByText(REMINDED)).toBeVisible();
  await expect(confirmed.getByText("Paid", { exact: true })).toBeVisible();
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

test("confirms a visit a credit covers as a credit used, never as a payment", async ({ page }) => {
  const hold = await holdAs(page, { credit: { remaining: 2 } });
  await bookedWithoutPaying(page, hold);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("1 visit credit used")).toBeVisible();
  await pay.getByRole("button", { name: "Confirm visit" }).click();

  const confirmed = page.getByRole("dialog").getByRole("status");
  await expect(confirmed.getByText("Confirmed")).toBeVisible();
  await expect(confirmed.getByText("1 visit credit used")).toBeVisible();
  await expect(confirmed.getByText("2 remaining")).toBeVisible();
  await expect(confirmed.getByText("Paid", { exact: true })).toHaveCount(0);
  await expect(confirmed.getByText("Rs. 2,000")).toHaveCount(0);
});

test("asks whether to remind the client on WhatsApp, and records it when they say yes", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await remindersAre(page, false);
  const switched: unknown[] = [];
  await page.route("**/api/consents/whatsapp_visits", (route) => {
    switched.push(route.request().postDataJSON());
    return route.fulfill({ json: { purpose: "whatsapp_visits", granted: true, since: new Date().toISOString() } });
  });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  const remind = pay.getByRole("checkbox", { name: REMIND });
  await expect(remind).not.toBeChecked();
  await remind.check();
  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();

  await expect(page.getByRole("dialog").getByRole("status").getByText(REMINDED)).toBeVisible();
  expect(switched).toEqual([{ granted: true }]);
});

test("promises no reminder the client has not agreed to", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await remindersAre(page, false);
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const confirmed = page.getByRole("dialog").getByRole("status");
  await expect(confirmed.getByText("Confirmed")).toBeVisible();
  await expect(confirmed.getByText(REMINDED)).toHaveCount(0);
});

test("offers the standard tier, and a way to ask for premium on WhatsApp", async ({ page }) => {
  await holdAs(page, { type: "first_fit", price: FIRST_FIT, late_fee: LATE_FEE });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("First fit · standard")).toBeVisible();
  await expect(pay.getByRole("link", { name: "Premium? Message us" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/919007973247\?text=.*premium%20first%20fit/,
  );
});

test("writes a first fit's late fee ex-GST, with the inclusive figure beside it", async ({ page }) => {
  await holdAs(page, { type: "first_fit", price: FIRST_FIT, late_fee: LATE_FEE });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText(LATE_FEE_LINE)).toBeVisible();
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
  const sheet = page.getByRole("dialog", { name: /^Move \w+day's visit$/ });
  await expect(sheet.getByText(LATE_FEE_LINE)).toBeVisible();
  const instead = await sheet.getByRole("button", { name: "Cancel the visit instead" }).boundingBox();
  expect(instead?.height).toBeGreaterThanOrEqual(44);
});

test("draws a change's outcome in the serif's one weight, never a made-up bold", async ({ page }) => {
  await page.route(/\/api\/appointments\/[0-9a-f-]{36}\/reschedule$/, (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal", request_id: "e2e" } } }),
  );
  await logIn(page, fittedClient().mobile);
  await page.getByRole("button", { name: "Reschedule" }).click();
  const outcome = page.getByRole("dialog").getByRole("heading", { name: /^That did not go through/ });
  await expect(outcome).toBeVisible();
  expect(await outcome.evaluate((heading) => getComputedStyle(heading).fontWeight)).toBe("400");
});

test("says so when the payment fails, with the hold counting outside the alert", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const sheet = page.getByRole("dialog", { name: "The payment did not go through." });
  const alert = sheet.getByRole("alert");
  await expect(alert).toContainText("The payment did not go through.");
  await expect(sheet.getByText(/^Slot held \d:\d\d more\.$/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Another method" })).toBeVisible();
  // A screen reader reads an alert again whenever it changes: the ticking count is kept out of it.
  const said = await alert.textContent();
  await page.waitForTimeout(2_000);
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
  const failed = page.getByRole("dialog").getByText("The payment did not go through.");
  await expect(failed).toBeVisible();
  await page.waitForTimeout(500);
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
  await page.clock.fastForward("00:20");
  const failed = page.getByRole("dialog", { name: "The payment did not go through." });
  await expect(failed.getByText(/^Slot held \d:\d\d more\.$/)).toBeVisible();
});

test("starts one payment, and one order, when the failed step is tapped twice", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const failed = page.getByRole("dialog", { name: "The payment did not go through." });
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

  await failed.getByRole("button", { name: "Try again" }).click();
  // Forced, because the tap this guards against is one the client makes whether the button takes it or not.
  await failed.getByRole("button", { name: "Another method" }).click({ force: true });
  const liveWhileBusy = await Promise.all([
    failed.getByRole("button", { name: "Try again" }).isEnabled(),
    failed.getByRole("button", { name: "Another method" }).isEnabled(),
  ]);

  await expect.poll(() => orders.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_500); // a second order, held the same second, would have landed by now
  expect({ asked, distinctOrders: new Set(orders).size, liveWhileBusy }).toEqual({
    asked: 1,
    distinctOrders: 1,
    liveWhileBusy: [false, false],
  });
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

test("lets a lapsed hold go the moment the phone sees it lapse, and picks again", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await page.clock.install();
  await toPayment(page);
  const released = page.waitForRequest(
    (request) => request.method() === "DELETE" && /\/api\/holds\/[0-9a-f-]{36}$/.test(request.url()),
    { timeout: 5_000 },
  );
  await page.clock.fastForward("11:00");
  const expired = page.getByRole("dialog", { name: "That slot has gone back." });
  await expect(expired).toBeVisible();
  await released;
  await expired.getByRole("button", { name: "Pick again" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
});

test("counts the hold on the API's clock, however far out the phone's is", async ({ page }) => {
  await fakeCheckout(page, "paid");
  // Eleven minutes fast: on the phone's own clock, the ten-minute hold would have lapsed before it began.
  await page.clock.install({ time: Date.now() + 11 * 60_000 });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText(/^Slot held (10:00|9:[45]\d)$/)).toBeVisible();
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
  await expect(told).toHaveText("One minute left to pay. Then the slot goes back.");
});

test("takes focus to each step's heading as the sheet moves on", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await openSheet(page);
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio").and(page.locator(":enabled")).first().click();
  await sheet.getByRole("button", { name: "Continue" }).click();
  await expect(sheet.getByRole("heading", { name: "Pick a window" })).toBeFocused();
  await continueToPayment(page);
  await expect(sheet.getByRole("heading", { name: "Pay and confirm" })).toBeFocused();
});

test("makes the days, the windows and the ways to pay one tab stop each, with arrow keys between", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await openSheet(page);
  const dates = page.getByRole("dialog", { name: "Pick a date" }).getByRole("radio").and(page.locator(":enabled"));
  await dates.first().click();
  await page.keyboard.press("ArrowRight");
  await expect(dates.nth(1)).toBeChecked();
  await expect(dates.nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();

  await page.keyboard.press("Enter");
  await continueToPayment(page);
  const upi = page.getByRole("radio", { name: "UPI · any app" });
  await upi.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Card" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Card" })).toBeFocused();
});

test("fits all fourteen days on a 320 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  const strip = await sheet.getByRole("radiogroup").boundingBox();
  const rights = await sheet
    .getByRole("radio")
    .evaluateAll((days) => days.map((day) => day.getBoundingClientRect().right));
  expect(rights).toHaveLength(14);
  for (const right of rights) expect(right).toBeLessThanOrEqual((strip?.x ?? 0) + (strip?.width ?? 0) + 0.5);
});

test("has a Close anyone can see, a full target, ringed in paper on the ground it stands on", async ({ page }) => {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  const close = sheet.getByRole("button", { name: "Close" });
  await expect(close).toBeVisible();
  expect(await close.evaluate((button) => getComputedStyle(button).opacity)).toBe("1");
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  for (
    let press = 0;
    press < 25 && !(await close.evaluate((button) => button === document.activeElement));
    press += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(close).toBeFocused();
  // The design has no focus ring, so it follows the ground: paper on the ink-night above the sheet, never gilt,
  // which on the sheet's paper was 1.86:1.
  expect(await close.evaluate((button) => getComputedStyle(button).outlineColor)).toBe("rgb(233, 228, 216)");
  // And ink on the sheet itself.
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement && getComputedStyle(document.activeElement).outlineColor),
  ).toBe("rgb(22, 35, 58)");
});

test("each booking step meets WCAG 2.2 AA", async ({ page }) => {
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  };
  await fakeCheckout(page, "paid");
  await openSheet(page);
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
