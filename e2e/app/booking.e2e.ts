// Booking in the app (boards C2 to C6) for the fitted client with an address of
// e2e/app/booker.ts, against the local mm-api, with Razorpay faked
// (e2e/app/checkout-fakes.ts): the address asked for first when there is none
// (ADR 0079), what booking also agrees to on the pay step (ADR 0080), and the
// service booked: picked first where its kind offers more than one, the one
// the app offers chosen (ADR 0085, ADR 0086).

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { PORTS } from "../../scripts/lib/local-stack.ts";
import { expect, test } from "../support.ts";
import { bookerClient } from "./booker.ts";
import {
  checkoutLeftOpen,
  checkoutOnTop,
  checkoutOpened,
  closedCheckout,
  confirmedByRazorpay,
  fakeCheckout,
  noRealCheckout,
  paidInCheckout,
} from "./checkout-fakes.ts";
import { fittedClient } from "./fitted.ts";
import { continueToPayment, TAKEN } from "./picking.ts";
import { logIn } from "./signed-in.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

const CHECKOUT = "https://checkout.razorpay.com/v1/checkout.js";
const REMIND = "Remind me on WhatsApp the day before";
const REMINDED = "Imran messages you the day before.";
/** A first fit and its late fee once GST applies, as it will in production (on staging GST is nothing). */
const FIRST_FIT = { amount_ex_gst: 3000000, amount: 3540000, gst_percent: 18 };
const LATE_FEE = { amount_ex_gst: 400000, amount: 472000, gst_percent: 18 };
const LATE_FEE_LINE = "Moving inside 24 hours costs Rs. 4,000 (Rs. 4,720 incl. GST). The balance carries over.";

type Hold = Record<string, unknown>;

/** A service ops added beside the service visit, which the local database does not hold, with GST as it will be. */
const PREMIUM = {
  type: "service",
  tier: "premium",
  name: "Premium service visit",
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
const indiaDay = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Passes one of the local mm-api's answers through, changed by `change`; `ask` changes the question first, where the
 * local mm-api would refuse the page's own. Only the browser resolves app.localhost, so the answer is fetched from
 * the app's server by its address, on the app's own host.
 */
async function passedThrough(
  page: Page,
  url: string | RegExp,
  change: (answer: never, asked: URL) => unknown,
  ask: (asked: URL) => URL = (asked) => asked,
) {
  await page.route(url, async (route) => {
    const asked = new URL(route.request().url());
    const sent = ask(new URL(asked));
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}${sent.pathname}${sent.search}`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    await route.fulfill({ response: answer, json: change((await answer.json()) as never, asked) });
  });
}

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
            next: { type: "service", tier: offered, date: indiaDay(1), window: null },
          },
        },
  );
  // The local database holds no premium service, so its days are the service visit's, under its own name.
  await passedThrough(
    page,
    /\/api\/availability\?/,
    (days: Record<string, unknown>, url) =>
      url.searchParams.get("tier") === "premium" ? { ...days, service: PREMIUM, price: PREMIUM.price } : days,
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

/** Opens the booking sheet from Visits. */
async function openSheet(page: Page): Promise<void> {
  await logIn(page, bookerClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  await page.getByRole("button", { name: "Book your next visit" }).click();
}

/** Logs in and picks the first free day, as far as the window step. */
async function toWindows(page: Page): Promise<void> {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  // The sheet asks the API for the services and the free days first; on 1 October 2026 a busy machine left it
  // "Loading" past the five seconds an expectation waits by default.
  await expect(sheet.getByText("Step 1 of 3")).toBeVisible({ timeout: 30_000 });
  await sheet.getByRole("radio").and(page.locator(":enabled")).first().click();
  await sheet.getByRole("button", { name: "Continue" }).click();
}

async function toPayment(page: Page): Promise<void> {
  await toWindows(page);
  await continueToPayment(page);
}

const PHOTOS = ["photos_own_record", "photos_referral_cards"];
const PURPOSES = [...PHOTOS, "photos_marketing", "whatsapp_visits", "whatsapp_launches"];
const ADDRESS = {
  line1: "House 4417, Tower C",
  line2: null,
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  access_notes: null,
  building: null,
  flat: null,
  floor: null,
  tower: null,
  landmark: null,
  place_id: null,
};

interface Standing {
  /** WhatsApp about their visits is on, so the sheet does not ask to remind them. */
  readonly reminders?: boolean;
  /** Photograph purposes never decided on; the others are given, as the booking client's are. */
  readonly undecided?: readonly string[];
  /** An address is saved; without one, the sheet asks for it first. */
  readonly address?: boolean;
}

/** The profile the sheet reads, for a client standing as `standing` says. */
function profileOf({ reminders = false, undecided = [], address = true }: Standing) {
  const at = new Date().toISOString();
  const consents = PURPOSES.map((purpose) => {
    const given = purpose === "whatsapp_visits" ? reminders : PHOTOS.includes(purpose) && !undecided.includes(purpose);
    return { purpose, granted: given, since: given ? at : null };
  });
  const answer = { name: "Rohit Malhotra", mobile: "+91 98xxx x4417", consents };
  const rest = { address_given_to_ops: null, number_change: null, number_change_decided: null, deletion: null };
  return { ...answer, address: address ? ADDRESS : null, ...rest };
}

/**
 * The client's profile as the sheet reads it. The booking client is shared by every test here, so each says what
 * it needs rather than depending on another's switch. Only the browser resolves app.localhost, so the profile is
 * answered whole rather than fetched and changed.
 */
async function profileAs(page: Page, standing: Standing): Promise<void> {
  await page.route("**/api/profile", (route) => route.fulfill({ json: profileOf(standing) }));
}

/** Every body the page sends to start a booking. */
function bookingsSent(page: Page): unknown[] {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/bookings")) sent.push(request.postDataJSON());
  });
  return sent;
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
      service: { tier: "standard", name: "Service visit", minutes: 90 },
      date: asked.date,
      window: asked.window,
      starts_at: `${asked.date}T06:30:00.000Z`,
      ends_at: `${asked.date}T10:30:00.000Z`,
      technician: { name: "Imran Qureshi", initials: "IQ" },
      price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
      late_fee: null,
      free_until: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      change_notice_hours: 24,
      late_change_charge: "visit",
      expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      pay_by: new Date(now + 12 * 60 * 1000).toISOString(),
      state: "held",
      paid: false,
      visit_id: null,
      moves_visit_id: null,
      credit: null,
      discount: null,
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
/** Waits until the hold's count has moved on a second, which is time passing with the sheet still up. */
async function ticked(sheet: Locator): Promise<void> {
  const count = sheet.getByText(/^Slot held \d:\d\d more\.$/);
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

test("books and pays for a service visit through Razorpay Checkout", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await profileAs(page, { reminders: true });
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
  // Both photograph consents are decided, so booking asks for neither, as board C4 draws it.
  await expect(pay.getByText(/^By booking this visit/)).toHaveCount(0);

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
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await pay.getByRole("button", { name: "Have a discount code?" }).click();
  await pay.getByLabel("Discount code").fill("wrong1");
  await pay.getByRole("button", { name: "Apply" }).click();
  await expect(pay.getByRole("alert")).toHaveText("That code does not apply to this visit.");

  applies = true;
  await pay.getByLabel("Discount code").fill("weddng25");
  await pay.getByRole("button", { name: "Apply" }).click();
  await expect(pay.getByText("Code WEDDNG25: Rs. 200 off")).toBeVisible();
  await expect(pay.getByRole("button", { name: "Pay Rs. 1,800" })).toBeVisible();
  await scanOf(page);

  await pay.getByRole("button", { name: "Remove code" }).click();
  await expect(pay.getByRole("button", { name: "Pay Rs. 2,000" })).toBeVisible();
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
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  const remind = pay.getByRole("checkbox", { name: REMIND });
  await expect(remind).not.toBeChecked();
  await remind.check();
  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();

  await expect(page.getByRole("dialog").getByRole("status").getByText(REMINDED)).toBeVisible();
  // Kept as given on the booking sheet (docs/decisions/0094-where-a-consent-was-given.md).
  expect(switched).toEqual([{ granted: true, source: "app_booking" }]);
});

test("promises no reminder the client has not agreed to", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await profileAs(page, { reminders: false });
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  const confirmed = page.getByRole("dialog").getByRole("status");
  await expect(confirmed.getByText("Confirmed")).toBeVisible();
  await expect(confirmed.getByText(REMINDED)).toHaveCount(0);
});

// The owner's ruling of 27 September 2026 (ADR 0079): an address before any slot.
test("asks a client with no address for it first, then books", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  // The first read finds no address; once the client has saved one, the profile is the API's own.
  let reads = 0;
  await page.route("**/api/profile", (route) => {
    reads += 1;
    return reads === 1 ? route.fulfill({ json: profileOf({ address: false }) }) : route.fallback();
  });
  await openSheet(page);
  const where = page.getByRole("dialog", { name: "Where we come" });
  await expect(where.getByText("Step 1 of 4")).toBeVisible();
  await expect(where.getByText("Your address first, so we know where to come. Then pick a date.")).toBeVisible();
  await scanOf(page);
  await where.getByLabel("Flat or house number").fill("House 4417");
  await where.getByLabel("Building, society or street").fill("Tower C");
  await where.getByLabel("Sector or area").fill("Sector 65");
  await where.getByLabel("City").fill("Gurgaon");
  await where.getByLabel("Pincode").fill("122018");
  await where.getByRole("button", { name: "Save and continue" }).click();

  const dates = page.getByRole("dialog", { name: "Pick a date" });
  await expect(dates.getByText("Step 2 of 4")).toBeVisible();
  await dates.getByRole("radio").and(page.locator(":enabled")).first().click();
  await dates.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a window" }).getByText("Step 3 of 4")).toBeVisible();
  await continueToPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
});

test("takes a client who has given their address straight to the date, as board C2 draws it", async ({ page }) => {
  await openSheet(page);
  await expect(page.getByRole("dialog", { name: "Pick a date" }).getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where we come" })).toHaveCount(0);
});

test("goes back to the address, saying why, when the API holds no slot for want of one", async ({ page }) => {
  await page.route("**/api/holds", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 409, json: { error: { code: "address_required", request_id: "e2e" } } })
      : route.fallback(),
  );
  await toWindows(page);
  const windows = page.getByRole("dialog", { name: "Pick a window" });
  await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
  await windows.getByRole("button", { name: "Continue to payment" }).click();
  const where = page.getByRole("dialog", { name: "Where we come" });
  await expect(where.getByRole("alert")).toHaveText(
    "We need your address before we can hold a slot. Add it, then pick your window again.",
  );
  await expect(where.getByRole("button", { name: "Save and continue" })).toBeVisible();
});

// The owner's ruling of 27 September 2026 (ADR 0080): booking agrees to the photograph purposes never decided on.
test("says on the pay step what booking also agrees to, while neither is decided, and sends both", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await profileAs(page, { reminders: true, undecided: PHOTOS });
  const sent = bookingsSent(page);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(
    pay.getByText("By booking this visit, you also agree to photographs for your own record and on referral cards."),
  ).toBeVisible();
  await expect(pay.getByText("Anyone you send this card to can see your photographs.")).toBeVisible();
  await expect(pay.getByText("Your first name appears on your invite.")).toBeVisible();
  await expect(pay.getByText("You can switch either off in Profile.")).toBeVisible();
  await scanOf(page);

  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
  expect(sent).toMatchObject([{ consents: PHOTOS }]);
});

test("shows only the line of a purpose still undecided, and sends only that one", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await profileAs(page, { reminders: true, undecided: ["photos_own_record"] });
  const sent = bookingsSent(page);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(
    pay.getByText("By booking this visit, you also agree to photographs for your own record."),
  ).toBeVisible();
  await expect(pay.getByText("You can switch it off in Profile.")).toBeVisible();
  await expect(pay.getByText("Your first name appears on your invite.")).toHaveCount(0);
  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect.poll(() => sent).toMatchObject([{ consents: ["photos_own_record"] }]);
});

// The owner's ruling of 27 September 2026 (ADR 0085): "Clients should see all the available options. There should
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
  await expect(kind).toContainText("Rs. 3,540 incl. GST");
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
  await expect(pay.getByText("Rs. 3,000", { exact: true })).toBeVisible();
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

test("writes a first fit's late fee ex-GST, with the inclusive figure beside it", async ({ page }) => {
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
  await expect(pay.getByText(/^Free to move until .+\. After that it is charged\.$/)).toBeVisible();
  await expect(pay.getByText(/Moving inside/)).toHaveCount(0);
});

test("says a visit moves or cancels free at any time where the booking is sold so", async ({ page }) => {
  await holdAs(page, { late_change_charge: "nothing" });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("Free to move or cancel at any time.")).toBeVisible();
  await expect(pay.getByText(/After that it is charged/)).toHaveCount(0);
});

test("says a credit is gone after a late cancel only where the booking is sold so", async ({ page }) => {
  await holdAs(page, { credit: { remaining: 2 }, late_change_charge: "nothing" });
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("1 visit credit used")).toBeVisible();
  await expect(pay.getByText(/the credit is gone/)).toHaveCount(0);
  await expect(pay.getByText("Free to move or cancel at any time.")).toBeVisible();
});

test("says a credit is gone after a cancel inside the notice the booking is sold under", async ({ page }) => {
  await holdAs(page, { credit: { remaining: 2 }, change_notice_hours: 48 });
  await toPayment(page);
  await expect(
    page.getByRole("dialog", { name: "Pay and confirm" }).getByText("Cancel inside 48 hours and the credit is gone."),
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
  const failed = page.getByRole("dialog").getByText("The payment did not go through.");
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
  const failed = page.getByRole("dialog", { name: "The payment did not go through." });
  // Checkout is given up on twenty seconds after it was last asked for. On a busy machine the pay step's own ask can
  // lapse before the tap, which asks again only once the order is in, after a single jump of the clock (1 October
  // 2026): so the clock moves on until the sheet has given up.
  await expect(async () => {
    await page.clock.fastForward("00:20");
    await expect(failed).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
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
  // Every order asked for has come back: a second one is let go with the first (e2e/app/one-tap.ts).
  await expect.poll(() => orders.length).toBe(asked);
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

// While Checkout is open the phone lets nothing go: a payment made in the grace after the countdown books (MON-03).
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
  await expect(page.getByRole("dialog", { name: "That slot has gone back." })).toBeVisible();
  expect(released).toEqual([]);
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

/** axe on the page as it stands, against WCAG 2.2 AA. */
async function scanOf(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

// A11Y-23: axe read C2 to C4 only; board C6's states, where a client is told something went wrong, went unread.
test("the payment's outcomes meet WCAG 2.2 AA: failed, the slot gone back, and confirmed", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await page.clock.install();
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog", { name: "The payment did not go through." })).toBeVisible();
  await scanOf(page);

  await page.clock.fastForward("11:00");
  await expect(page.getByRole("dialog", { name: "That slot has gone back." })).toBeVisible();
  await scanOf(page);
});

test("a confirmed booking meets WCAG 2.2 AA", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog", { name: "Confirmed" })).toBeVisible({ timeout: 15_000 });
  await scanOf(page);
});

// Every app project runs with reduced motion, so the sheets' movement was never read by axe or the keyboard.
test.describe("with motion, as most phones have it", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the booking sheet rises and moves between steps, keeps the focus in it, and meets WCAG 2.2 AA", async ({
    page,
  }) => {
    await openSheet(page);
    const dates = page.getByRole("dialog", { name: "Pick a date" });
    await expect(dates).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await scanOf(page);
    await expect.poll(() => dates.evaluate((sheet) => sheet.contains(document.activeElement))).toBe(true);

    await dates.getByRole("radio").and(page.locator(":enabled")).first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    const windows = page.getByRole("dialog", { name: "Pick a window" });
    await expect(windows).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await scanOf(page);
    await expect.poll(() => windows.evaluate((sheet) => sheet.contains(document.activeElement))).toBe(true);
  });
});

test("each booking step meets WCAG 2.2 AA", async ({ page }) => {
  const scan = () => scanOf(page);
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
