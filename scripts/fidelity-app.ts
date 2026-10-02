// The client app's fidelity pairs (docs/fidelity-method.md, "Phase 2 boards"):
// each frame of design/phase2/Client App.dc.html that P2-F1 and P2-F2 build,
// beside the built app in the same state, at the frames' 390 px.
//
//   npm run build:app -- --env local && npm run fidelity:app
//
// The app's API is answered with the design's own example (Rohit Malhotra, a
// consultation on Sat 21 Sep; fitted, his next service visit on Thu 19 Sep
// with Imran), so both sides show the same things. The design's photographs
// are ink blocks with the angle written on them; the app's are answered with
// blocks of the same ink, and carry no captions, as the prompt has it. The phone's
// status bar the frames draw above each screen is board furniture: it is
// cropped off, and the app is shot 44 px shorter to match.
//
// Writes docs/fidelity/client-app/<name>.jpg: the design on the left, the build
// on the right. Differences in type, spacing, colour or order are defects.

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import { pair, rest, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
import { serveDirectory } from "./lib/static-server.ts";
import type { components } from "../apps/app/src/api-schema.ts";

type Schemas = components["schemas"];

const APP_DIR = resolve("apps/app/dist/local");
const DESIGN_DIR = resolve("design/phase2");
const APP = "http://127.0.0.1:4314";
const DESIGN = "http://127.0.0.1:4313/Client%20App.dc.html";
const OUT = resolve("docs/fidelity/client-app");

const WIDTH = 390;
const FRAME_HEIGHT = 844;
const STATUS_BAR = 44;

// ---- The design's example, as the API would answer it -------------------------

const ME = {
  state: "lead",
  name: "Rohit Malhotra",
  first_name: "Rohit",
  initials: "RM",
  // A Saturday, as the design's "Sat 21 Sep" is.
  consultation: {
    date: "2030-09-21",
    window: "morning",
    window_label: "before noon",
    place: "Sector 65, Gurgaon 122018",
  },
  next_visit: null,
  credits: null,
  prompt: null,
  invoice: null,
  booking: { self_serve: false, types: ["consultation"] },
};

// ---- Fitted (P2-F2) --------------------------------------------------------------

const IMRAN = { name: "Imran Qureshi", initials: "IQ" };
const SANDEEP = { name: "Sandeep Rawat", initials: "SR" };
const PLACE = "Sector 65, Gurgaon 122018";

const visit = (n: number, date: string, type: string, technician: typeof IMRAN) => ({
  id: `c0000000-0000-4000-8000-00000000000${String(n)}`,
  date,
  window_label: "afternoon",
  starts_at: `${date}T06:30:00.000Z`,
  ends_at: `${date}T08:00:00.000Z`,
  length_minutes: 90,
  type,
  status: "completed",
  stage: null,
  prepaid: false,
  technician,
  place: PLACE,
});

/** A Thursday, as B1's "Thu 19 Sep" is; paid ahead, as C1's "Prepaid" says. */
const NEXT = { ...visit(1, "2030-09-19", "service", IMRAN), status: "scheduled", stage: "booked", prepaid: true };
const PAST = [
  visit(2, "2027-08-22", "service", IMRAN),
  visit(3, "2027-07-25", "service", IMRAN),
  visit(4, "2027-06-27", "replacement", SANDEEP),
  visit(5, "2026-11-14", "first_fit", IMRAN),
] as const;
const [AUGUST, JULY, , NOVEMBER] = PAST;

/**
 * What those visits and board E1's ledger add up to (src/domain/client-history.ts).
 * The spend is every entry the ledger draws as paid or charged, GST included;
 * the credited visit cost nothing and the refund has not gone back yet.
 */
const HISTORY = {
  visits: 4,
  services: 2,
  replacements: 1,
  first_fit_on: "2026-11-14",
  last_visit_on: "2027-08-22",
  spend: 6_018_000,
  replacement_due: { month: "2028-03" },
};

/** B1's credit tile, two credits expiring 3 Jan 2028, and its one prompt, the replacement due in March. */
const ME_FITTED = {
  ...ME,
  state: "fitted",
  consultation: null,
  next_visit: NEXT,
  credits: { visits: 2, earliest_expiry: "2028-01-03T00:00:00.000Z" },
  prompt: { kind: "replacement_due", month: "2028-03" },
  booking: { self_serve: false, types: ["service", "replacement"] },
};

const ANGLES = ["front", "top", "left", "right", "hair"];
/** The five angles after a visit, each answered with a block of `ink` (see PHOTO_FILES). */
const photoSet = (ink: string) => ({
  before: [],
  after: ANGLES.map((angle) => ({
    angle,
    url: `/api/photos/file/${ink}`,
    thumbnail_url: null,
    width: 600,
    height: 800,
  })),
});
const PHOTO_FILES = { ink: "#16233a", frame: "#131c2e", raised: "#1a2740" } as const;

/**
 * The visit's own tax invoice, issued, is drawn beneath its facts; the board has no row for it (ADR 0056). What
 * was done is the board's own words, as the checklist items the technician ticked.
 */
const VISIT_DETAIL = {
  ...AUGUST,
  duration_minutes: 85,
  outcome: "done",
  what_was_done: ["Removed", "cleaned", "re-taped", "re-bonded", "trimmed"],
  photos: photoSet("ink"),
  document_id: AUGUST.id,
  invoice_expected: true,
  invoice_held: null,
  no_show: null,
};

const timeline = (inks: readonly [string, string, string]) => ({
  visits: [AUGUST, JULY, NOVEMBER].map((each, index) => ({
    visit_id: each.id,
    date: each.date,
    type: each.type,
    photos: photoSet(inks[index] ?? "ink"),
  })),
  // No board draws a try-on (ADR 0082), so the boards' client has none.
  try_ons: [],
});
/** Board D2 draws the earlier visit on ink-frame and the later on ink-raised. */
const TIMELINE = timeline(["ink", "ink", "ink"]);
const COMPARED = timeline(["raised", "ink", "frame"]);

const visitRef = (each: (typeof PAST)[number]) => ({ id: each.id, date: each.date, type: each.type });
const paid = (n: number, of: (typeof PAST)[number], exGst: number, method: string, reference: string) => ({
  kind: "payment",
  id: `e0000000-0000-4000-8000-00000000000${String(n)}`,
  date: of.date,
  amount: exGst * 1.18,
  amount_ex_gst: exGst,
  gst_percent: 18,
  visit: visitRef(of),
  status: "captured",
  method,
  reference,
  refunded_amount: 0,
  purpose: "visit",
  charge: null,
  no_show: null,
});
const SERVICE_PAID = paid(2, AUGUST, 200000, "upi", "MM-2027-0841");
/** Board E1's entries that exist before booking (P2-M5): the charge and the credit arrive with it. */
const ENTRIES = {
  entries: [
    {
      kind: "refund",
      id: "e0000000-0000-4000-8000-000000000001",
      payment_id: "e0000000-0000-4000-8000-000000000009",
      date: "2027-09-14",
      amount: 236000,
      amount_ex_gst: 200000,
      gst_percent: 18,
      visit: { id: "c0000000-0000-4000-8000-000000000009", date: "2027-09-16", type: "service" },
      status: "created",
      destination: "upi",
      speed: "normal",
    },
    SERVICE_PAID,
    paid(3, PAST[2], 1500000, "upi", "MM-2027-0512"),
    paid(4, NOVEMBER, 3000000, "card", "MM-2026-0102"),
  ],
  credits: [],
};
const ENTRY = { ...SERVICE_PAID, documents: { invoice: AUGUST.id, receipt: null } };
/** The clock for the payments: in 2027, so its entries drop the year, as E1's do. */
const IN_2027 = new Date("2027-09-20T05:00:00Z");

// ---- Booking (P2-F5) ----------------------------------------------------------------

/** Booking on: the design's strip runs Mon 16 to Sun 29 Sep, with the 17th, 24th and 28th full. */
const ME_BOOKING = { ...ME_FITTED, booking: { self_serve: true, types: ["service", "replacement"] } };
const FULL_DAYS = new Set([1, 8, 12]);
const AVAILABILITY = {
  type: "service",
  price: { amount_ex_gst: 200000, amount: 236000, gst_percent: 18 },
  regular: IMRAN,
  days: Array.from({ length: 14 }, (_, index) => ({
    date: `2030-09-${String(16 + index)}`,
    windows: FULL_DAYS.has(index)
      ? ["morning", "afternoon", "evening"].map((window) => ({ window, with: null }))
      : [
          { window: "morning", with: null },
          { window: "afternoon", with: "regular" },
          { window: "evening", with: "another" },
        ],
  })),
};
/** The clock for booking: Monday 16 September 2030, the strip's first day. */
/**
 * The design's referrer: two credits left, and two friends fitted (boards F1 and F5). They have agreed to the
 * cards' lines, so their own card can be chosen (F2), and the invite names them (F4).
 */
const REFER = {
  code: "RM4417",
  link: "https://maneman.in/r/RM4417",
  named: true,
  credits: { visits: 2, earliest_expiry: "2028-01-03T00:00:00.000Z" },
  card: { state: "house", version: 1, consented: true },
  fitted: [
    { first_name: "Vikram", month: "2027-08" },
    { first_name: "Ashish", month: "2027-03" },
  ],
  invite_credits: null,
};

const IN_2030 = new Date("2030-09-16T05:00:00Z");
const hold = (type: string, price: object, lateFee: object | null) => ({
  id: "b0000000-0000-4000-8000-000000000001",
  type,
  date: "2030-09-19",
  window: "afternoon",
  starts_at: "2030-09-19T06:30:00.000Z",
  ends_at: "2030-09-19T08:00:00.000Z",
  technician: IMRAN,
  price,
  late_fee: lateFee,
  free_until: "2030-09-18T06:30:00.000Z",
  change_notice_hours: 24,
  // The committed terms: a first fit's late fee, a service visit kept.
  late_change_charge: lateFee === null ? "visit" : "late_fee",
  // Board C4 shows 9:42 left.
  expires_at: new Date(IN_2030.getTime() + 582_000).toISOString(),
  state: "held",
  paid: false,
  visit_id: null,
  moves_visit_id: null,
  credit: null,
});
const SERVICE_HOLD = hold("service", { amount_ex_gst: 200000, amount: 236000, gst_percent: 18 }, null);
const FIRST_FIT_HOLD = hold(
  "first_fit",
  { amount_ex_gst: 3000000, amount: 3540000, gst_percent: 18 },
  { amount_ex_gst: 400000, amount: 472000, gst_percent: 18 },
);
const BOOKING = {
  hold_id: SERVICE_HOLD.id,
  checkout: {
    key_id: "rzp_test_fidelity",
    order_id: "order_fidelity",
    amount: 236000,
    currency: "INR",
    name: "Mane Man",
    description: "Service visit, 2030-09-19",
    prefill: { name: "Rohit Malhotra", contact: "+919800044417" },
  },
};

/** Razorpay's Checkout, replaced by one that pays or fails as it opens. */
function fakeCheckout(outcome: "paid" | "failed") {
  return (route: Route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.Razorpay = function (options) {
        const failed = [];
        this.on = (event, handler) => { if (event === "payment.failed") failed.push(handler); };
        this.open = () => setTimeout(() => ${
          outcome === "paid" ? "options.handler({})" : "failed.forEach((handler) => handler({}))"
        }, 10);
      };`,
    });
}

const PROFILE = {
  name: "Rohit Malhotra",
  mobile: "+91 98xxx x4417",
  address: {
    line1: "House 4417, Tower C",
    line2: null,
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: "Gate code 4417 · park in visitor bay B",
  },
  consents: [
    { purpose: "photos_own_record", granted: true, since: "2026-11-14T06:00:00Z" },
    { purpose: "photos_referral_cards", granted: true, since: "2027-08-03T06:00:00Z" },
    { purpose: "photos_marketing", granted: false, since: null },
    { purpose: "whatsapp_visits", granted: true, since: "2026-11-02T06:00:00Z" },
    { purpose: "whatsapp_launches", granted: false, since: null },
  ],
  number_change: null,
  number_change_decided: null,
  deletion: null,
};

/** A code sent 30 seconds ago, as board A2 is drawn: SMS offered, WhatsApp's resend 18 s away. */
const CHALLENGE = {
  challenge_id: "0b6c2f0e-6a57-4f7e-9a51-3f0f5c1d2e44",
  channel: "whatsapp",
  expires_in_s: 600,
  resend_in_s: 48,
  sms_in_s: 30,
};

type Api = Readonly<Record<string, (route: Route) => Promise<void>>>;

const json =
  (body: unknown, headers: Record<string, string> = {}) =>
  (route: Route) =>
    route.fulfill({ json: body, headers });
const signedOut = (route: Route) =>
  route.fulfill({ status: 401, json: { error: { code: "unauthorised", message: "Log in to continue." } } });
const never = () => new Promise<void>(() => undefined);

// ---- Pages ------------------------------------------------------------------

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STILL });
  await page.evaluate(() => document.fonts.ready);
}

async function openDesign(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await routeDesignLibraries(page);
  await page.goto(DESIGN, { waitUntil: "networkidle" });
  await page.locator('[data-screen-label="Profile · account"]').waitFor();
  await settle(page);
  return page;
}

/** The app with its API answered from `api` (anything else unauthorised), 44 px shorter than a frame. */
async function openApp(
  browser: Browser,
  path: string,
  api: Api,
  now?: Date,
  checkout?: (route: Route) => Promise<void>,
): Promise<Page> {
  // The app's policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: FRAME_HEIGHT - STATUS_BAR },
    bypassCSP: true,
    serviceWorkers: "block",
  });
  await page.clock.install(now === undefined ? {} : { time: now });
  if (checkout !== undefined) await page.route("https://checkout.razorpay.com/v1/checkout.js", checkout);
  await page.route("**/api/**", (route) => {
    const answer = api[new URL(route.request().url()).pathname] ?? signedOut;
    return answer(route);
  });
  await page.goto(`${APP}${path}`);
  await settle(page);
  return page;
}

/** A frame of the board, with the status bar above a phone screen cropped off. */
async function frame(design: Page, label: string, statusBar = true): Promise<Buffer> {
  const shot = await design.locator(`[data-screen-label="${label}"]`).screenshot();
  if (!statusBar) return shot;
  const { width, height } = await sharp(shot).metadata();
  return sharp(shot)
    .extract({ left: 0, top: STATUS_BAR, width, height: height - STATUS_BAR })
    .toBuffer();
}

/** One of a states board's small frames, by its caption: B3's Loading, Offline or Error, and so on. */
function stateFrame(design: Page, caption: string, board = "Home · states"): Promise<Buffer> {
  return design
    .locator(`[data-screen-label="${board}"] > div`)
    .filter({ has: design.getByText(caption, { exact: true }) })
    .screenshot();
}

/** Every photograph on the page arrived and faded in. */
async function photographsIn(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  await page.waitForFunction(() => [...document.images].every((image) => getComputedStyle(image).opacity === "1"));
}

async function shot(page: Page): Promise<Buffer> {
  await page.evaluate(() => document.fonts.ready);
  await rest(page);
  return page.screenshot();
}

// ---- The pairs ----------------------------------------------------------------

async function login(browser: Browser, design: Page): Promise<void> {
  const api: Api = { "/api/me": signedOut, "/api/auth/otp": json(CHALLENGE) };

  const app = await openApp(browser, "/", api);
  await app.getByRole("textbox", { name: "Mobile number" }).fill("9800044417");
  // The design draws the number typed, the field no longer focused.
  await app.getByRole("textbox", { name: "Mobile number" }).blur();
  await pair(OUT, WIDTH, "a1-mobile", await frame(design, "Login · mobile"), await shot(app));

  // A2 and A3 draw their back arrow in the band where A1 has the status bar: it is the screen's own, so
  // they are shot at the frame's full height.
  await app.setViewportSize({ width: WIDTH, height: FRAME_HEIGHT });
  await app.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await app.getByRole("textbox", { name: "The six-digit code" }).fill("418");
  await app.clock.runFor(30_000);
  await pair(OUT, WIDTH, "a2-code-after-30-seconds", await frame(design, "Login · OTP", false), await shot(app));

  await app.getByRole("button", { name: "No booking on this number?" }).click();
  await pair(OUT, WIDTH, "a3-not-recognised", await frame(design, "Login · not recognised", false), await shot(app));
  await app.close();
}

async function home(browser: Browser, design: Page): Promise<void> {
  const app = await openApp(browser, "/", { "/api/me": json(ME) });
  await app.getByRole("heading", { name: "Your consultation" }).waitFor();
  await pair(OUT, WIDTH, "b2-lead", await frame(design, "Home · lead"), await shot(app));
  await app.close();
}

async function states(browser: Browser, design: Page): Promise<void> {
  const loading = await openApp(browser, "/profile", { "/api/me": json(ME), "/api/profile": never });
  // Signed in first: a cold start shows the same loading before there is a frame around it.
  await loading.getByRole("navigation").waitFor();
  await loading.getByRole("status").filter({ hasText: "Loading" }).waitFor({ state: "attached" });
  await pair(OUT, WIDTH, "b3-loading", await stateFrame(design, "Loading"), await shot(loading));
  await loading.close();

  const offline = await openApp(browser, "/", { "/api/me": json(ME, { "Mm-Served-From": "cache" }) });
  await offline.getByText("No connection. Showing your last update.").waitFor();
  await pair(OUT, WIDTH, "b3-offline", await stateFrame(design, "Offline"), await shot(offline));
  await offline.close();

  // The phone kept a Home with the consultation on it, so the error can say the visit is still booked.
  const failed = await openApp(browser, "/", { "/api/me": (route) => route.abort() });
  await failed.evaluate(async (home) => {
    const kept = await caches.open("mm-app-home");
    await kept.put("/api/me", new Response(JSON.stringify(home)));
  }, ME);
  await failed.reload();
  await failed.getByText("Your visit is still booked.").waitFor();
  await pair(OUT, WIDTH, "b3-error", await stateFrame(design, "Error"), await shot(failed));
  await failed.close();
}

async function profile(browser: Browser, design: Page): Promise<void> {
  const app = await openApp(browser, "/profile", { "/api/me": json(ME), "/api/profile": json(PROFILE) });
  await app.getByRole("heading", { name: "Where we come" }).waitFor();
  await pair(OUT, WIDTH, "g1-profile", await frame(design, "Profile"), await shot(app));

  // G2 draws the account's three cards on their own: the app's are shot from the first to the last, with
  // the page let out of its scrolling frame so they are all in one picture.
  await app.addStyleTag({ content: "#root > div { height: auto !important; } main { overflow: visible !important; }" });
  const edge = (heading: string, side: "top" | "bottom") =>
    app
      .locator("section", { has: app.getByRole("heading", { name: heading }) })
      .evaluate((element, which) => element.getBoundingClientRect()[which] + window.scrollY, side);
  const top = await edge("Change mobile number", "top");
  const bottom = await edge("Delete your account", "bottom");
  await rest(app);
  const cards = await app.screenshot({ fullPage: true, clip: { x: 0, y: top, width: WIDTH, height: bottom - top } });
  await pair(OUT, WIDTH, "g2-account", await frame(design, "Profile · account", false), cards);
  await app.close();
}

async function fitted(browser: Browser, design: Page): Promise<void> {
  const files: Record<string, (route: Route) => Promise<void>> = {};
  for (const [name, background] of Object.entries(PHOTO_FILES)) {
    const body = await sharp({ create: { width: 600, height: 800, channels: 3, background } })
      .jpeg()
      .toBuffer();
    files[`/api/photos/file/${name}`] = (route) => route.fulfill({ body, contentType: "image/jpeg" });
  }
  const me = { "/api/me": json(ME_FITTED), ...files };

  const home = await openApp(browser, "/", me);
  await home.getByRole("heading", { name: "Your next visit" }).waitFor();
  await pair(OUT, WIDTH, "b1-fitted", await frame(design, "Home · fitted"), await shot(home));
  await home.close();

  const visits = await openApp(browser, "/visits", {
    ...me,
    "/api/visits": json({ upcoming: [NEXT], past: PAST, history: HISTORY }),
  });
  await visits.getByRole("heading", { name: "Past" }).waitFor();
  await pair(OUT, WIDTH, "c1-visits", await frame(design, "Visits · list"), await shot(visits));
  await visits.close();

  // C9's tax invoice is not on the board at all.
  const detail = await openApp(browser, `/visits/${AUGUST.id}`, {
    ...me,
    [`/api/visits/${AUGUST.id}`]: json(VISIT_DETAIL),
  });
  await detail.getByRole("heading", { name: "Photographs from this visit" }).waitFor();
  await photographsIn(detail);
  await pair(OUT, WIDTH, "c9-visit", await frame(design, "Visit detail"), await shot(detail));
  await detail.close();

  const photos = await openApp(browser, "/photos", { ...me, "/api/photos": json(TIMELINE) });
  await photos.getByRole("heading", { name: "22 Aug 2027" }).waitFor();
  await photographsIn(photos);
  await pair(OUT, WIDTH, "d1-timeline", await frame(design, "Photos · timeline"), await shot(photos));
  await photos.getByRole("button", { name: "Front, after the visit, 22 Aug 2027" }).click();
  await photos.getByRole("dialog").waitFor();
  await photographsIn(photos);
  await pair(OUT, WIDTH, "d3-download", await stateFrame(design, "Download", "Photos · states"), await shot(photos));
  await photos.close();

  // The divider is set where D2 draws it, 48% across.
  const compare = await openApp(browser, "/photos/compare", { ...me, "/api/photos": json(COMPARED) });
  const stage = compare.getByRole("slider").locator("..");
  await stage.waitFor();
  const box = await stage.boundingBox();
  if (box !== null) await compare.mouse.click(box.x + box.width * 0.48, box.y + box.height / 2);
  await photographsIn(compare);
  await pair(OUT, WIDTH, "d2-compare", await frame(design, "Photos · compare"), await shot(compare));
  await compare.close();

  const none = await openApp(browser, "/photos", { ...me, "/api/photos": json({ visits: [], try_ons: [] }) });
  await none.getByText("Your photographs start at your first fit.").waitFor();
  await pair(
    OUT,
    WIDTH,
    "d3-empty",
    await stateFrame(design, "Empty · before the first fit", "Photos · states"),
    await shot(none),
  );
  await none.close();

  const loading = await openApp(browser, "/photos", { ...me, "/api/photos": never });
  await loading.getByRole("status").filter({ hasText: "Loading" }).waitFor({ state: "attached" });
  await pair(OUT, WIDTH, "d3-loading", await stateFrame(design, "Loading", "Photos · states"), await shot(loading));
  await loading.close();

  // E1's entries are newest first, where the board lists them in no order; its charge and credit arrive
  // with booking (P2-M5).
  const list = await openApp(browser, "/payments", { ...me, "/api/payments": json(ENTRIES) }, IN_2027);
  await list.getByText("MM-2027-0841").or(list.getByText("Paid").first()).first().waitFor();
  await pair(OUT, WIDTH, "e1-payments", await frame(design, "Payments · list"), await shot(list));
  await list.close();

  // E2's method row names the UPI app, which Razorpay's payment does not always carry.
  const entry = await openApp(
    browser,
    `/payments/${SERVICE_PAID.id}`,
    { ...me, [`/api/payments/${SERVICE_PAID.id}`]: json(ENTRY) },
    IN_2027,
  );
  await entry.getByRole("heading", { name: "Tax documents" }).waitFor();
  await pair(OUT, WIDTH, "e2-entry", await frame(design, "Payments · detail"), await shot(entry));
  await entry.getByRole("button", { name: "Receipt" }).click();
  await entry.getByText("Ask us for it").waitFor();
  await pair(
    OUT,
    WIDTH,
    "e3-unavailable",
    await stateFrame(design, "Document unavailable", "Payments · states"),
    await shot(entry),
  );
  await entry.close();

  const lead = await openApp(browser, "/payments", {
    "/api/me": json(ME),
    "/api/payments": json({ entries: [], credits: [] }),
  });
  await lead.getByText("Nothing to pay yet.").waitFor();
  await pair(OUT, WIDTH, "e3-empty", await stateFrame(design, "Empty · lead", "Payments · states"), await shot(lead));
  await lead.close();
}

async function bookingPairs(browser: Browser, design: Page): Promise<void> {
  const api = (holdAnswer: object, polled: object = holdAnswer): Api => ({
    "/api/me": json(ME_BOOKING),
    // WhatsApp about visits is on, as the board's confirmation promises, so the sheet does not ask.
    "/api/profile": json(PROFILE),
    "/api/visits": json({ upcoming: [], past: PAST, history: HISTORY }),
    "/api/availability": json(AVAILABILITY),
    "/api/holds": json(holdAnswer),
    "/api/bookings": json(BOOKING),
    [`/api/holds/${SERVICE_HOLD.id}`]: json(polled),
  });

  /** From Visits to the sheet's pay step, shooting each board on the way. */
  async function throughTheSheet(app: Page, shots: boolean): Promise<void> {
    await app.getByRole("button", { name: "Book your next visit" }).click();
    await app.getByRole("radio", { name: "Thursday 19 Sep" }).click();
    if (shots) await pair(OUT, WIDTH, "c2-date", await frame(design, "Booking · date"), await shot(app));
    await app.getByRole("button", { name: "Continue" }).click();
    await app.getByRole("radio", { name: /Afternoon/ }).click();
    if (shots) await pair(OUT, WIDTH, "c3-window", await frame(design, "Booking · window"), await shot(app));
    await app.getByRole("button", { name: "Continue to payment" }).click();
    await app.getByRole("heading", { name: "Pay and confirm" }).waitFor();
  }

  /**
   * The hold's countdown as board C4 letters it, 9:42, however long the sheet took to reach the pay step: the clock
   * is held at the moment the hold was made, so every run shoots the same figure.
   */
  async function holdAsDrawn(app: Page): Promise<void> {
    await app.clock.setFixedTime(IN_2030);
    await app.getByText("9:42").waitFor();
  }

  /** The sheet alone, as board C5 draws its two cards alone, without the dark ground above it. */
  const sheetShot = async (app: Page): Promise<Buffer> => {
    await rest(app);
    return app.locator("dialog[open] > div").screenshot();
  };

  // C4's saved card ("Card ending 4417") is Checkout's to offer; the app offers card payment as "Card".
  const service = await openApp(browser, "/visits", api(SERVICE_HOLD), IN_2030);
  await throughTheSheet(service, true);
  await holdAsDrawn(service);
  await pair(OUT, WIDTH, "c4-pay", await frame(design, "Booking · pay"), await shot(service));
  await service.close();

  const firstFit = await openApp(browser, "/visits", api(FIRST_FIT_HOLD), IN_2030);
  await throughTheSheet(firstFit, false);
  await holdAsDrawn(firstFit);
  const firstFitFrame = design
    .locator('[data-screen-label="Booking · credit"] > div')
    .filter({ has: design.getByText("First fit · guarantee line added", { exact: true }) })
    .screenshot();
  await pair(OUT, WIDTH, "c5-first-fit", await firstFitFrame, await sheetShot(firstFit));
  await firstFit.close();

  // A service visit a credit covers: the design's two credits, one used.
  const credited = await openApp(browser, "/visits", api({ ...SERVICE_HOLD, credit: { remaining: 1 } }), IN_2030);
  await throughTheSheet(credited, false);
  await holdAsDrawn(credited);
  const creditFrame = design
    .locator('[data-screen-label="Booking · credit"] > div')
    .filter({ has: design.getByText("Credit covers it · payment skipped", { exact: true }) })
    .screenshot();
  await pair(OUT, WIDTH, "c5-credit", await creditFrame, await sheetShot(credited));
  await credited.close();

  const failed = await openApp(browser, "/visits", api(SERVICE_HOLD), IN_2030, fakeCheckout("failed"));
  await throughTheSheet(failed, false);
  await failed.getByRole("button", { name: /^Pay/ }).click();
  await failed.getByText("The payment did not go through.").waitFor();
  await pair(
    OUT,
    WIDTH,
    "c6-failed",
    await stateFrame(design, "Payment failed", "Booking · pay states"),
    await shot(failed),
  );
  await failed.close();

  const expired = await openApp(browser, "/visits", api(SERVICE_HOLD), IN_2030);
  await throughTheSheet(expired, false);
  await expired.clock.fastForward("10:00");
  await expired.getByText("That slot has gone back.").waitFor();
  await pair(
    OUT,
    WIDTH,
    "c6-expired",
    await stateFrame(design, "Hold expired", "Booking · pay states"),
    await shot(expired),
  );
  await expired.close();

  const booked = { ...SERVICE_HOLD, state: "booked", paid: true, visit_id: NEXT.id };
  const confirmed = await openApp(browser, "/visits", api(SERVICE_HOLD, booked), IN_2030, fakeCheckout("paid"));
  await throughTheSheet(confirmed, false);
  await confirmed.getByRole("button", { name: /^Pay/ }).click();
  await confirmed.clock.fastForward("00:03");
  await confirmed.getByText("Imran messages you the day before.").waitFor();
  const confirmedFrame = design
    .locator('[data-screen-label="Booking · pay states"] > div')
    .filter({ has: design.getByText("Confirmed", { exact: true }) })
    .screenshot();
  await pair(OUT, WIDTH, "c6-confirmed", await confirmedFrame, await shot(confirmed));
  await confirmed.close();
}

/** Boards C7 and C8: what moving or cancelling Thursday's service visit costs, shown before the client confirms. */
async function changePairs(browser: Browser, design: Page): Promise<void> {
  // Typed as the API answers, so a fixture cannot leave a field out: without `credit`, C7's late move read as a
  // credit's beside the board's paid visit.
  const terms = {
    visit_id: NEXT.id,
    type: "service",
    notice_hours: 24,
    free_until: "2030-09-18T06:30:00.000Z",
    paid: 236000,
    credit: null,
  } as const;
  const move = (notice: "free" | "late"): Schemas["MoveTerms"] => ({
    ...terms,
    notice,
    cost: notice === "free" ? "free" : "charged",
    price:
      notice === "free"
        ? { amount_ex_gst: 0, amount: 0, gst_percent: 18 }
        : { amount_ex_gst: 200000, amount: 236000, gst_percent: 18 },
  });
  const cancel: Schemas["CancelTerms"] = {
    ...terms,
    notice: "free",
    refund: 236000,
    kept: 0,
    destination: "upi",
    cancelled: false,
  };
  const api = (notice: "free" | "late"): Api => ({
    "/api/me": json(ME_BOOKING),
    [`/api/appointments/${NEXT.id}/reschedule`]: json(move(notice)),
    [`/api/appointments/${NEXT.id}/cancel`]: json(cancel),
  });
  const version = (board: string, caption: string) =>
    design
      .locator(`[data-screen-label="${board}"] > div`)
      .filter({ has: design.getByText(caption, { exact: true }) })
      .screenshot();

  // The app adds a way from C7 to C8, which the design draws but does not reach; C8 says 5 to 7 working days,
  // as the owner ruled (ADR 0025, item 28), where the design says three to five.
  const free = await openApp(browser, "/", api("free"), IN_2030);
  await free.getByRole("button", { name: "Reschedule" }).click();
  await free.getByText("Free to move. Your Rs. 2,360 carries over.").waitFor();
  await pair(OUT, WIDTH, "c7-free", await version("Reschedule", "More than 24 hours out"), await shot(free));
  await free.getByRole("button", { name: "Cancel the visit instead" }).click();
  await free.getByText("Rs. 2,360 back to your UPI in 5 to 7 working days.").waitFor();
  await pair(OUT, WIDTH, "c8-free", await version("Cancel", "More than 24 hours out"), await shot(free));
  await free.close();

  const late = await openApp(browser, "/", api("late"), IN_2030);
  await late.getByRole("button", { name: "Reschedule" }).click();
  await late.getByText(/^Charged\./).waitFor();
  await pair(OUT, WIDTH, "c7-late", await version("Reschedule", "Inside 24 hours"), await shot(late));
  await late.close();
}

/** Boards F1 to F6: the invite, which card, the preview, and who has been fitted. */
async function referPairs(browser: Browser, design: Page): Promise<void> {
  // The first fit's two front photographs, as the blocks of ink F2 draws either side of the rule.
  const firstFit = {
    visit_id: NOVEMBER.id,
    date: NOVEMBER.date,
    type: "first_fit",
    photos: {
      before: [{ angle: "front", url: "/api/photos/file/frame", thumbnail_url: null, width: 600, height: 800 }],
      after: [{ angle: "front", url: "/api/photos/file/raised", thumbnail_url: null, width: 600, height: 800 }],
    },
  };
  const files: Record<string, (route: Route) => Promise<void>> = {};
  for (const [name, background] of Object.entries(PHOTO_FILES)) {
    const body = await sharp({ create: { width: 600, height: 800, channels: 3, background } })
      .jpeg()
      .toBuffer();
    files[`/api/photos/file/${name}`] = (route) => route.fulfill({ body, contentType: "image/jpeg" });
  }
  const api: Api = {
    "/api/me": json(ME_FITTED),
    "/api/refer": json(REFER),
    "/api/photos": json({ visits: [firstFit] }),
    ...files,
  };

  const landing = await openApp(browser, "/refer", api);
  await landing.getByRole("button", { name: "Share an invite" }).waitFor();
  await pair(OUT, WIDTH, "f1-refer", await frame(design, "Refer · landing"), await shot(landing));

  // F2 draws their own card chosen, which an agreement to the cards' lines allows.
  await landing.getByRole("button", { name: "Share an invite" }).click();
  await landing.getByRole("heading", { name: "Which card?" }).waitFor();
  await landing.getByRole("radio", { name: /My before and after/ }).click();
  await photographsIn(landing);
  await pair(OUT, WIDTH, "f2-card-choice", await frame(design, "Refer · card choice"), await shot(landing));

  // The example needs no consent: the sheet goes straight to the preview, the house card in the bubble.
  await landing.getByRole("radio", { name: /A Mane Man example/ }).click();
  await landing.getByRole("button", { name: "Continue to share" }).click();
  await landing.getByRole("heading", { name: /^Preview/ }).waitFor();
  await photographsIn(landing);
  await pair(OUT, WIDTH, "f4-share", await frame(design, "Refer · share"), await shot(landing));

  // F6's share failure: copying the link refused, beside the board's small frame.
  await landing.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("refused", "NotAllowedError"));
  });
  await landing.getByRole("button", { name: "Copy link" }).click();
  await landing.getByText("The link did not generate. Nothing was sent.").waitFor();
  await pair(
    OUT,
    WIDTH,
    "f6-share-failed",
    await stateFrame(design, "Share failed", "Refer · empty and revoke"),
    await shot(landing),
  );
  await landing.close();

  // F6's revoke, for a client whose own card is on their invite.
  const revoke = await openApp(browser, "/refer/fitted", {
    ...api,
    "/api/refer": json({ ...REFER, card: { state: "personal", version: 2, consented: true } }),
  });
  await revoke.getByRole("button", { name: "Revoke the photo card" }).click();
  await revoke.getByRole("heading", { name: "Switch off your photographs?" }).waitFor();
  await pair(
    OUT,
    WIDTH,
    "f6-revoke",
    await stateFrame(design, "Revoke the photo card", "Refer · empty and revoke"),
    await shot(revoke),
  );
  await revoke.close();

  const tracker = await openApp(browser, "/refer/fitted", api);
  await tracker.getByText("Ashish").waitFor();
  await pair(OUT, WIDTH, "f5-tracker", await frame(design, "Refer · tracker"), await shot(tracker));
  await tracker.close();

  const empty = await openApp(browser, "/refer/fitted", {
    ...api,
    "/api/refer": json({ ...REFER, fitted: [], credits: { visits: 0, earliest_expiry: null } }),
  });
  await empty.getByText("Nobody you have referred has been fitted yet.").waitFor();
  const emptyFrame = design
    .locator('[data-screen-label="Refer · empty and revoke"] > div')
    .filter({ has: design.getByText("Tracker · empty", { exact: true }) })
    .screenshot();
  await pair(OUT, WIDTH, "f6-tracker-empty", await emptyFrame, await shot(empty));
  await empty.close();
}

const servers: Server[] = [
  await serveDirectory(APP_DIR, 4314, undefined, { spa: true }),
  await serveDirectory(DESIGN_DIR, 4313),
];
const browser = await chromium.launch();
try {
  rmSync(OUT, { recursive: true, force: true });
  console.log(`fidelity: the client app at ${String(WIDTH)} px`);
  const design = await openDesign(browser);
  await login(browser, design);
  await home(browser, design);
  await states(browser, design);
  await profile(browser, design);
  await fitted(browser, design);
  await bookingPairs(browser, design);
  await changePairs(browser, design);
  await referPairs(browser, design);
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
