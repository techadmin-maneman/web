// Booking in the app for the fitted client with an address of
// e2e/app/booker.ts, against the local mm-api, with Razorpay faked
// (e2e/app/checkout-fakes.ts): the address asked for first when there is none
// (ADR 0079), what booking also agrees to on the pay step (ADR 0080), and the
// service booked: picked first where its kind offers more than one, the one
// the app offers chosen (ADR 0085, ADR 0086).

import type { Page } from "@playwright/test";
import { addDays, indiaDate } from "../../src/lib/india-time.ts";
import { expect, test } from "../support.ts";
import { noRealCheckout } from "./checkout-fakes.ts";
import { continueToPayment } from "./picking.ts";
import {
  FREE_UNTIL,
  toPayment,
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

/** A service ops added beside the service visit, which the local database does not hold, with GST as it will be. */
const PREMIUM = {
  type: "service",
  tier: "premium",
  name: "Premium service visit",
  description: "A deeper clean and a fresh bond.",
  minutes: 120,
  price: { amount_ex_gst: 300000, amount: 354000, gst_percent: 18 },
};

interface Offered {
  readonly type: string;
  readonly tier: string;
}

interface Booking {
  readonly services: Offered[];
  readonly next: unknown;
}

/** India's date `days` from today. */
const indiaDay = (days: number) => addDays(indiaDate(new Date()), days);

/**
 * The booker's Home with a premium service visit beside the standard one, and a service visit offered next as the
 * service `offered`, tomorrow. Signed out, Home is a refusal, and passes as it is.
 */
async function premiumBeside(page: Page, offered: string): Promise<void> {
  await passedThrough(page, "**/api/me", (me: { booking?: Booking }) =>
    me.booking === undefined
      ? me
      : {
          ...me,
          booking: {
            ...me.booking,
            services: me.booking.services.flatMap((each) =>
              each.type === "service" && each.tier === "standard" ? [each, PREMIUM] : [each],
            ),
            next: { type: "service", tier: offered, due_on: indiaDay(1), date: indiaDay(1), window: null },
          },
        },
  );
  // The local database holds no premium service, so its days are the service visit's, under its own name.
  await passedThrough(
    page,
    /\/api\/availability\?/,
    (days: Record<string, unknown>, url) =>
      url.searchParams.get("tier") === "premium"
        ? {
            ...days,
            service: { tier: PREMIUM.tier, name: PREMIUM.name, minutes: PREMIUM.minutes },
            price: PREMIUM.price,
          }
        : days,
    (url) => {
      url.searchParams.delete("tier");
      return url;
    },
  );
}

/** Every body the page sends to hold a window. */
function holdsSent(page: Page): unknown[] {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/holds")) sent.push(request.postDataJSON());
  });
  return sent;
}

/** Picks a visit on the sheet's first step, where its kind offers more than one, and goes on. */
async function pickVisit(page: Page, name: RegExp): Promise<void> {
  const visits = page.getByRole("dialog", { name: "Pick a visit" });
  await visits.getByRole("radio", { name }).check();
  await visits.getByRole("button", { name: "Continue" }).click();
}

/** From the date step, the first free day and a free window, as far as the pay step. */
async function datesToPayment(page: Page): Promise<void> {
  const dates = page.getByRole("dialog", { name: "Pick a date" });
  await dates.getByRole("radio").and(page.locator(":enabled")).first().click();
  await dates.getByRole("button", { name: "Continue" }).click();
  await continueToPayment(page);
}

// "Clients should see all the available options. There should
// be no message us for anything."
test("offers every service of the kind it books, the one offered chosen, with how long each takes and what it costs", async ({
  page,
}) => {
  await premiumBeside(page, "standard");
  await openSheet(page);
  const visits = page.getByRole("dialog", { name: "Pick a visit" });
  await expect(visits.getByText("Step 1 of 4")).toBeVisible();
  const kind = visits.getByRole("radiogroup", { name: "Service visit" });
  await expect(kind.getByRole("radio")).toHaveCount(2);
  // The service the app offers the next visit as, which the client may keep or change.
  const standard = kind.getByRole("radio", { name: /^Service visit/ });
  await expect(standard).toBeChecked();
  await expect(kind).toContainText("1 hour 30 minutes");
  await expect(kind).toContainText("Rs. 2,000");
  await expect(kind).toContainText("2 hours");
  // The line ops wrote for a service sits under its name; one with none shows its name alone.
  await expect(kind).toContainText("A deeper clean and a fresh bond.");
  // Once GST applies, what is charged leads and its split sits beneath.
  await expect(kind).toContainText("Rs. 3,540");
  await expect(kind).toContainText("Rs. 3,000 + Rs. 540 GST");
  await expect(visits.getByRole("link")).toHaveCount(0);
  await scanOf(page);
  // One choice among them, one tab stop, and the arrow keys move between them.
  await standard.focus();
  await page.keyboard.press("ArrowDown");
  await expect(kind.getByRole("radio", { name: /^Premium service visit/ })).toBeChecked();
  await expect(kind.getByRole("radio", { name: /^Premium service visit/ })).toBeFocused();
});

test("opens on the service offered, books it, and names it on the pay step", async ({ page }) => {
  await premiumBeside(page, "premium");
  const held = holdsSent(page);
  await holdAs(page, { service: { tier: "premium", name: PREMIUM.name, minutes: 120 }, price: PREMIUM.price });
  await openSheet(page);
  const visits = page.getByRole("dialog", { name: "Pick a visit" });
  await expect(visits.getByRole("radio", { name: /^Premium service visit/ })).toBeChecked();
  await visits.getByRole("button", { name: "Continue" }).click();
  await datesToPayment(page);

  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("Premium service visit", { exact: true })).toBeVisible();
  await expect(pay.getByText("Rs. 3,540", { exact: true })).toBeVisible();
  await expect(pay.getByText("Rs. 3,000 + Rs. 540 GST", { exact: true })).toBeVisible();
  expect(held).toMatchObject([{ type: "service", tier: "premium" }]);
});

test("books another service of the kind the client picks instead of the one offered", async ({ page }) => {
  await premiumBeside(page, "premium");
  const held = holdsSent(page);
  await holdAs(page, {});
  await openSheet(page);
  await pickVisit(page, /^Service visit/);
  await datesToPayment(page);
  await expect(
    page.getByRole("dialog", { name: "Pay and confirm" }).getByText("Service visit", { exact: true }),
  ).toBeVisible();
  expect(held).toMatchObject([{ type: "service", tier: "standard" }]);
});

test("books the one service of its kind without asking, and names it on the pay step", async ({ page }) => {
  const held = holdsSent(page);
  await holdAs(page, {});
  await toPayment(page);
  await expect(page.getByRole("heading", { name: "Pick a visit" })).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Pay and confirm" }).getByText("Service visit", { exact: true }),
  ).toBeVisible();
  expect(held).toMatchObject([{ type: "service", tier: "standard" }]);
});

test("names a first fit's service and how long it takes, and sends no one to WhatsApp for another", async ({
  page,
}) => {
  await holdAs(page, {
    type: "first_fit",
    service: { tier: "standard", name: "First fit", minutes: 180 },
    price: FIRST_FIT,
    late_fee: LATE_FEE,
    late_change_charge: "late_fee",
  });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("First fit", { exact: true })).toBeVisible();
  await expect(pay.getByText("3 hours", { exact: true })).toBeVisible();
  await expect(pay.getByText("Premium? Message us")).toHaveCount(0);
  await expect(pay.locator('a[href*="wa.me"]')).toHaveCount(0);
});

test("writes a first fit's late fee as charged, with its GST split beside it", async ({ page }) => {
  await holdAs(page, { type: "first_fit", price: FIRST_FIT, late_fee: LATE_FEE, late_change_charge: "late_fee" });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText(LATE_FEE_LINE)).toBeVisible();
});

// What a late change costs is what the booking is sold under, which ops set (docs/decisions/0088-every-policy-in-the-console.md).
test("says a late change keeps the payment, never a late fee, where the booking is sold so", async ({ page }) => {
  await holdAs(page, { type: "first_fit", price: FIRST_FIT, late_fee: null, late_change_charge: "visit" });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText(FREE_UNTIL)).toBeVisible();
  await expect(pay.getByText(/Moving inside/)).toHaveCount(0);
});
