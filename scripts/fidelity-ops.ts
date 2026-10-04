// The ops console's fidelity pairs (docs/fidelity-method.md, "Phase 2 boards"):
// each frame of design/phase2/Ops Console.dc.html that the console builds,
// beside the built console in the same state. The console is drawn at 1440;
// boards B2, B3, C1 to C3, D1, D2 and D3 are panels within it, 660 and 484 px
// wide, drawn at their own size, so each pair is a panel beside a panel.
//
//   npm run build:ops -- --env local && npm run fidelity:ops
//
// The console's API is answered with the board's own figures, so both sides
// show the same things. No mm-api runs. The clock is set to 2027, the year the
// board's waiting dates fall in, so they read without a year as the board
// writes them.
//
// Writes docs/fidelity/ops/<name>.jpg: the design on the left, the build on
// the right. Differences in type, spacing, colour or order are defects.
//
// Boards A1 and B1 draw the console whole at 1440 and show it at 1000, so their
// pairs are the console's own frame brought down to 1000; every other pair is a
// panel beside a panel, at its own size.

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import { BOARD, DISPUTES, PIECES, ROOM, TASKS } from "../e2e/ops/fixtures.ts";
import { pair, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
import { serveDirectory } from "./lib/static-server.ts";

const OPS_DIR = resolve("apps/ops/dist/local");
const DESIGN_DIR = resolve("design/phase2");
const OPS = "http://127.0.0.1:4316";
const DESIGN = "http://127.0.0.1:4315/Ops%20Console.dc.html";
const OUT = resolve("docs/fidelity/ops");

/** The console's own width, the width the boards show it at, and its panels' two widths. */
const CONSOLE = 1440;
const SHOWN = 1000;
const QUEUE = 660;
const PANEL = 484;

/** The year the board's waiting dates fall in, so "4 Feb" needs no year. */
const IN_2027 = new Date("2027-09-22T05:00:00Z");
/** India's 10:42, the time board B2 letters on the opened photographs. */
const AT_1042 = new Date("2027-09-22T05:12:00Z");
/**
 * Two days before the week board A1 heads, Fri 19 to Thu 25 September, whose
 * days fall as it draws them in 2025. Two days, so the visit A2 moves is more
 * than 24 hours off and its panel carries no line about a charge.
 */
const BEFORE_THE_WEEK = new Date("2025-09-17T05:00:00Z");

// ---- Board C1: the grants the fraud rules held ------------------------------

const person = (n: number, name: string) => ({ person_id: `11000000-0000-4000-8000-00000000000${String(n)}`, name });
/** Each held as long before IN_2027 as the board writes: "3 days held", "1 day held", "5 hours held". */
const held = (n: number, referrer: string, referred: string, heldSince: string, signal: string) => ({
  id: `aa000000-0000-4000-8000-00000000000${String(n)}`,
  referrer: person(n, referrer),
  referred: person(n + 5, referred),
  fitted_on: heldSince.slice(0, 10),
  signals: [signal],
  held_since: heldSince,
  due: new Date(Date.parse(heldSince) + 48 * 3_600_000).toISOString(),
});
const HELD = {
  held: [
    held(1, "Rohit Malhotra", "Vikram Sethi", "2027-09-19T05:00:00.000Z", "shared_address"),
    held(2, "Ashish Gill", "Manoj Gill", "2027-09-21T05:00:00.000Z", "shared_upi"),
    held(3, "Karan Bose", "Nikhil Arora", "2027-09-22T00:00:00.000Z", "monthly_cap"),
  ],
};

// ---- Board C2: every referrer's figures, as the route orders them ------------

const referrer = (code: string, name: string, figures: readonly [number, number, number, number, number]) => ({
  code,
  name,
  opens: figures[0],
  consultations: figures[1],
  fits: figures[2],
  granted: figures[3],
  redeemed: figures[4],
});
const REFERRERS = {
  referrers: [
    referrer("KB1102", "Karan Bose", [19, 9, 6, 15, 2]),
    referrer("RM4417", "Rohit Malhotra", [7, 3, 2, 6, 4]),
    referrer("AG2208", "Ashish Gill", [4, 2, 1, 3, 3]),
    referrer("NA0731", "Nikhil Arora", [5, 1, 1, 3, 1]),
    referrer("VS0916", "Vikram Sethi", [1, 0, 0, 0, 0]),
  ],
  more: false,
};

// ---- Board C3: who is waiting, and the pincode about to launch ---------------

const area = (
  pincode: string,
  name: string,
  city: string,
  oldest: string,
  figures: readonly [number, number, number],
) => ({
  pincode,
  area: name,
  city,
  served: false,
  launched_at: null,
  waiting: figures[0],
  oldest: `${oldest}T06:00:00.000Z`,
  referred: figures[1],
  alerts: figures[2],
});
const AREAS = {
  areas: [
    area("400050", "Bandra W", "Mumbai", "2027-02-04", [117, 31, 84]),
    area("400026", "Cumballa", "Mumbai", "2027-03-19", [64, 12, 41]),
    area("560034", "Koramangala", "Bengaluru", "2027-04-02", [58, 9, 44]),
    area("110024", "Lajpat Nagar", "Delhi", "2027-01-28", [46, 18, 30]),
    area("201301", "Noida 18", "Noida", "2027-05-11", [39, 14, 27]),
  ],
  more: false,
};
const PREVIEW = { pincode: "400050", waiting: 117, alerts: 84, launched: false };

// ---- Boards B2 and B3: the client the board draws ----------------------------

const CLIENT_ID = "22000000-0000-4000-8000-000000000001";
const TECHNICIAN = { name: "Imran Qureshi", initials: "IQ" };
const RECORD = {
  id: CLIENT_ID,
  name: "Rohit Malhotra",
  mobile: "+919810004417",
  state: "fitted",
  known_since: "2026-11-01T06:00:00.000Z",
  address: null,
  credits: { visits: 2, earliest_expiry: "2028-01-03T06:00:00.000Z" },
  visits: { upcoming: [], past: [] },
  payments: [],
  payment_links: [],
  invoices: [],
  invite: null,
  /*
   * The board's own client, counted from the visits and ledger the client app's
   * boards draw of him: a first fit, two service visits and a replacement, and
   * the piece B1's table still has in wear, falling due in the month the page
   * head writes.
   */
  history: {
    visits: 4,
    services: 2,
    replacements: 1,
    first_fit_on: "2026-11-14",
    last_visit_on: "2027-08-22",
    spend: 6_018_000,
    replacement_due: { on: "2028-03-01", month: "2028-03", piece_code: "MM-STD-4417-C" },
  },
};

/** The board draws one visit's five angles; a visit whose before set was not taken is that. */
const ANGLES = ["front", "top", "left", "right", "hair"] as const;
const PHOTOS = {
  visits: [
    {
      visit_id: "33000000-0000-4000-8000-000000000001",
      date: "2027-08-22",
      type: "service",
      technician: TECHNICIAN,
      photos: ANGLES.map((angle, n) => ({
        id: `44000000-0000-4000-8000-00000000000${String(n)}`,
        phase: "after",
        angle,
        width: 600,
        height: 800,
        taken_at: "2027-08-22T04:30:00.000Z",
      })),
    },
  ],
};

// ---- Board D1: the case the board rules on, with its three facts -------------

/**
 * The board's own: Vikram's visit booked for 11:30, checked in at 11:31, 240 m
 * out, the WhatsApp delivered 11:32, closed at 11:47.
 */
const NO_SHOWS = {
  cases: [
    {
      id: "66000000-0000-4000-8000-000000000001",
      appointment_id: "77000000-0000-4000-8000-000000000001",
      person: { id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
      visit_date: "2027-09-19",
      technician: "Imran Qureshi",
      checked_in_at: "2027-09-19T06:01:00.000Z",
      phone_checked_in_at: "2027-09-19T06:01:00.000Z",
      received_at: "2027-09-19T06:01:00.000Z",
      window_start: "2027-09-19T06:00:00.000Z",
      window_end: "2027-09-19T07:30:00.000Z",
      minutes_late: 1,
      distance_m: 240,
      radius_m: 200,
      message_state: "delivered",
      message_delivered_at: "2027-09-19T06:02:00.000Z",
      wait_ends_at: "2027-09-19T06:16:00.000Z",
      closed_at: "2027-09-19T06:17:00.000Z",
      opened_at: "2027-09-19T06:17:00.000Z",
      due: "2027-09-21T06:17:00.000Z",
      decision: "undecided",
      decided_at: null,
    },
  ],
};

/**
 * The day's money over its charges, board D1's first card: its own three
 * figures and its two charges, the no-show priced at Rs. 2,360 like the late
 * cancellation, as the board draws it and its charge now records.
 */
const DAY_MONEY = {
  date: "2027-09-22",
  collected: 8_400_000,
  refunds_processing: 708_000,
  refunded: 236_000,
  charged: 472_000,
  charges: [
    {
      id: "b1000000-0000-4000-8000-000000000001",
      kind: "no_show",
      person: { id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
      amount: 236_000,
      // Ruled this morning on yesterday's visit, so the list's own order is the route's.
      at: "2027-09-22T02:30:00.000Z",
      visit_started_at: "2027-09-21T06:00:00.000Z",
      change: null,
      technician: "Imran Qureshi",
    },
    {
      id: "b1000000-0000-4000-8000-000000000002",
      kind: "late_cancellation",
      person: { id: "11000000-0000-4000-8000-000000000005", name: "Aman Tyagi" },
      amount: 236_000,
      at: "2027-09-22T03:44:00.000Z",
      visit_started_at: "2027-09-22T04:30:00.000Z",
      change: "cancelled",
      technician: null,
    },
  ],
};

// ---- Board D3: the roster, with the phones the board does not draw -----------

const phone = (id: string, label: string | null, seen: string) => ({
  device_id: id,
  label,
  last_seen_at: `${seen}T05:00:00.000Z`,
  revoked_at: null,
});
const worker = (n: number, name: string, initials: string, zone: string, seen: string) => ({
  id: `88000000-0000-4000-8000-00000000000${String(n)}`,
  name,
  initials,
  zone,
  devices: [phone(`a41c09e27f3${String(n)}`, "Chrome on Android", seen)],
  // The board draws no leave; the roster's Leave column then reads as a gap.
  leave: [],
});
const TECHNICIANS = {
  technicians: [
    worker(1, "Imran Qureshi", "IQ", "Sec 40–65", "2027-09-22"),
    worker(2, "Sandeep Yadav", "SY", "Sec 1–39", "2027-09-22"),
    worker(3, "Arjun Negi", "AN", "DLF 1–5", "2027-09-21"),
    worker(4, "Faizan Ali", "FA", "Sohna Rd", "2027-09-20"),
  ],
};

/** The board's own four averages, against the 90 minutes a service visit is planned for. */
const figures = (n: number, jobs: number, timed: number, minutes: number) => ({
  technician_id: `88000000-0000-4000-8000-00000000000${String(n)}`,
  jobs,
  timed_jobs: timed,
  average_minutes: minutes,
  average_planned_minutes: 90,
  skill: null,
});
const TECHNICIAN_WORK = {
  from: "2027-06-24",
  to: "2027-09-23",
  technicians: [figures(1, 48, 48, 84), figures(2, 41, 41, 91), figures(3, 44, 44, 79), figures(4, 29, 29, 108)],
};

const consent = (purpose: string, state: string, version: string | null, at: string | null, source: string | null) => ({
  purpose,
  state,
  notice_version: version,
  at,
  source,
});
/** The board's sources, "App" and "Site", as the places the console names (docs/fidelity-method.md). */
const CONSENTS = {
  consents: [
    consent("photos_own_record", "given", "photos-own-record-v1", "2026-11-14T08:00:00.000Z", "app_profile"),
    consent("photos_referral_cards", "given", "photos-referral-cards-v2", "2027-08-03T08:00:00.000Z", "app_profile"),
    consent("photos_marketing", "not_given", null, null, null),
    consent("whatsapp_visits", "given", "referral-consultation-v1", "2026-11-02T08:00:00.000Z", "site_booking"),
    consent("whatsapp_launches", "withdrawn", "whatsapp-launches-v1", "2027-01-11T08:00:00.000Z", "app_profile"),
  ],
  deletion: null,
};

// ---- Pages -------------------------------------------------------------------

type Api = Readonly<Record<string, (route: Route) => Promise<void>>>;
const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });
const missing = (route: Route) => route.fulfill({ status: 404, json: { error: { code: "not_found" } } });

/** The design's photographs are ink blocks; the console's are answered with the same ink. */
const inkBlock = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#16233a" } })
  .jpeg()
  .toBuffer();
const photoFiles = Object.fromEntries(
  (PHOTOS.visits[0]?.photos ?? []).map((photo) => [
    `/api/clients/${CLIENT_ID}/photos/${photo.id}`,
    (route: Route) => route.fulfill({ body: inkBlock, contentType: "image/jpeg" }),
  ]),
);

const API: Api = {
  // Board A1's "AK", as Access would name a member of staff whose initials they are.
  "/api/whoami": json({ signed_in_as: "aditya.kumar@maneman.in", sign_out: "/cdn-cgi/access/logout" }),
  // Boards A1 to A3 are answered with the week the browser tests use, so the
  // board's figures are written once and both read beside it (e2e/ops/fixtures.ts).
  "/api/dispatch": json(BOARD),
  "/api/dispatch/room": json(ROOM),
  "/api/referrals/held": json(HELD),
  "/api/referrers": json(REFERRERS),
  "/api/waitlist": json(AREAS),
  "/api/pincodes/400050/launch": json(PREVIEW),
  [`/api/clients/${CLIENT_ID}`]: json(RECORD),
  [`/api/clients/${CLIENT_ID}/pieces`]: json(PIECES),
  [`/api/clients/${CLIENT_ID}/photos`]: json(PHOTOS),
  // Logged at India's 10:42, the time the board letters, and opened once before, as its "AK · 19 Sep" says.
  [`/api/clients/${CLIENT_ID}/photos/view`]: json({
    logged_at: AT_1042.toISOString(),
    before: [{ by: "ak@maneman.in", at: "2027-09-19T05:30:00.000Z" }],
  }),
  [`/api/clients/${CLIENT_ID}/consents`]: json(CONSENTS),
  "/api/payments": json(DAY_MONEY),
  "/api/no-shows": json(NO_SHOWS),
  // Board D1's second card, Vikram's disputed charge (e2e/ops/fixtures.ts).
  "/api/no-shows/disputes": json(DISPUTES),
  // The tasks are read against IN_2027, the day their dates are written for (e2e/ops/fixtures.ts).
  "/api/tasks": json(TASKS),
  "/api/technicians": json(TECHNICIANS),
  "/api/technicians/work": json(TECHNICIAN_WORK),
  ...photoFiles,
};

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STILL });
  await page.evaluate(() => document.fonts.ready);
}

async function openDesign(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await routeDesignLibraries(page);
  await page.goto(DESIGN, { waitUntil: "networkidle" });
  await page.locator('[data-screen-label="Waitlist"]').waitFor();
  await settle(page);
  return page;
}

/**
 * The console with its API answered from `API`. The frame the console draws
 * scrolls its own section; for a screenshot the page is let out of it, so a
 * panel taller than the window is caught whole.
 */
async function openConsole(browser: Browser, path: string, at: Date = IN_2027, letOut = true): Promise<Page> {
  // The console's policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({
    viewport: { width: CONSOLE, height: 900 },
    bypassCSP: true,
    serviceWorkers: "block",
  });
  await page.clock.install({ time: at });
  await page.route("**/api/**", (route) => {
    const answer = API[new URL(route.request().url()).pathname] ?? missing;
    return answer(route);
  });
  await page.goto(`${OPS}${path}`);
  await settle(page);
  // Board A1 draws the console whole, so that one is shot inside its own frame.
  if (letOut) {
    await page.addStyleTag({
      content: "#root > div { height: auto !important; } main { overflow: visible !important; }",
    });
  }
  return page;
}

/** The console at 1440, brought down to the 1000 px board A1 shows it at. */
const shrink = (image: Buffer, width: number) => sharp(image).resize({ width }).png().toBuffer();

/** A frame of the board, by its label. */
const frame = (design: Page, label: string) => design.locator(`[data-screen-label="${label}"]`).screenshot();

/** One panel of a frame that draws several states one above the other, as B2 does. */
const panelOf = (design: Page, label: string, nth: number) =>
  design.locator(`[data-screen-label="${label}"] > div`).nth(nth).screenshot();

// ---- The pairs ----------------------------------------------------------------

/**
 * Boards A1, A2 and A3: the week's board, the drawer a block opens, and the
 * reason a move carries. A2 and A3 are reached as ops reach them, by opening a
 * block and moving it; nothing is written, because the panel sends only on
 * "Move and notify".
 */
async function dispatch(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/dispatch", BEFORE_THE_WEEK, false);
  const block = page.getByRole("button", { name: "Rohit M., Fri 19 Sep, morning" });
  await block.waitFor();
  await settle(page);
  await pair(OUT, SHOWN, "a1-dispatch", await frame(design, "Dispatch"), await shrink(await page.screenshot(), SHOWN));

  await block.click();
  const drawer = page.getByRole("dialog", { name: "Rohit Malhotra" });
  await drawer.getByText("Service visit · 1 slot").waitFor();
  await pair(OUT, PANEL, "a3-block-drawer", await frame(design, "Dispatch · drawer"), await drawer.screenshot());

  await page.getByRole("button", { name: "Move this visit" }).click();
  await page.getByRole("button", { name: "Move Rohit M. to Sandeep Yadav, Sat 20 Sep, morning" }).click();
  const picker = page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" });
  await picker.getByText("Fri 19 Sep, morning → Sat 20 Sep, morning").waitFor();
  await pair(OUT, PANEL, "a2-move-reason", await frame(design, "Dispatch · drag"), await picker.screenshot());
  await page.close();
}

async function referrals(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/referrals");
  await page.getByRole("heading", { name: "Held for review" }).waitFor();
  await page.getByText("Opens and consultations stay here.").waitFor();

  const queue = page.getByRole("region", { name: "Held for review" });
  await pair(OUT, QUEUE, "c1-held-for-review", await frame(design, "Referrals · queue"), await queue.screenshot());

  const table = page.getByRole("region", { name: "All referrers" });
  await pair(OUT, QUEUE, "c2-referrers", await frame(design, "Referrals · table"), await table.screenshot());
  await page.close();
}

async function waitlist(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/waitlist");
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await page.getByText("This messages 84 people").waitFor();

  // The board's frame is the table and the confirmation, one above the other, which is the section itself.
  const column = page.locator("main > div");
  await pair(OUT, PANEL, "c3-waitlist-and-launch", await frame(design, "Waitlist"), await column.screenshot());
  await page.close();
}

/**
 * Board B2, in both states. The board draws them one above the other; the
 * console shows one at a time, so each is paired with its own panel.
 */
async function photos(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, `/clients/${CLIENT_ID}/photos`, AT_1042);
  const panel = page.getByRole("region", { name: "Photographs of Rohit Malhotra" });
  await panel.getByRole("heading", { name: "Photographs of Rohit Malhotra" }).waitFor();
  await pair(OUT, PANEL, "b2-photos-locked", await panelOf(design, "Client · photos", 0), await panel.screenshot());

  await page.getByRole("button", { name: "View photos" }).click();
  await page.getByText("22 Aug 2027 · service visit · Imran Qureshi").waitFor();
  await settle(page);
  await pair(OUT, PANEL, "b2-photos-open", await panelOf(design, "Client · photos", 1), await panel.screenshot());
  await page.close();
}

/**
 * Board D1, both of its cards: the day's money over the charges it was kept on,
 * and a disputed charge (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
 */
async function noShows(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/no-shows");
  const money = page.getByRole("region", { name: "Today", exact: true });
  await money.getByText("Cancelled 9:14 am · visit was 10 am").waitFor();
  await pair(OUT, PANEL, "d1-day-money", await panelOf(design, "Payments", 0), await money.screenshot());

  const dispute = page.getByRole("region", { name: "Vikram Sethi disputes the charge" });
  await dispute.getByText("240 m · over 200 m fence").waitFor();
  await pair(OUT, PANEL, "d1-disputed-charge", await panelOf(design, "Payments", 1), await dispute.screenshot());
  await page.close();
}

/**
 * Board B1, the client's page with its pieces table. The board draws it whole
 * at 1440, as it draws A1, so its pair is the console's own frame brought down
 * to the 1000 px it shows it at.
 */
async function pieces(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, `/clients/${CLIENT_ID}/pieces`, IN_2027, false);
  await page.getByText("MM-STD-4417-C").waitFor();
  await settle(page);
  await pair(OUT, SHOWN, "b1-pieces", await frame(design, "Client page"), await shrink(await page.screenshot(), SHOWN));
  await page.close();
}

/** Board D2, the queues ops still have to work through, on the panel the board draws. */
async function tasks(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/tasks");
  const panel = page.getByRole("region", { name: "Tasks" });
  await panel.getByText("Nothing is closed here.").waitFor();
  await pair(OUT, PANEL, "d2-tasks", await frame(design, "Tasks"), await panel.screenshot());
  await page.close();
}

/** Board D3, the roster and its figures, one row a technician; the phones and the leave open in a panel over it. */
async function technicians(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/technicians");
  const panel = page.getByRole("region", { name: "Technicians" });
  await panel.getByText("1 h 48 m").waitFor();
  await pair(OUT, PANEL, "d3-technicians", await frame(design, "Technicians"), await panel.screenshot());
  await page.close();
}

/** Board B3, the consents, which ops read and never change. */
async function consents(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, `/clients/${CLIENT_ID}/consents`);
  const panel = page.getByRole("region", { name: "Consents" });
  await page.getByText("Ops cannot grant a consent.").waitFor();
  await pair(OUT, PANEL, "b3-consents", await frame(design, "Client · consents"), await panel.screenshot());
  await page.close();
}

const servers: Server[] = [
  await serveDirectory(OPS_DIR, 4316, undefined, { spa: true }),
  await serveDirectory(DESIGN_DIR, 4315),
];
const browser = await chromium.launch();
try {
  rmSync(OUT, { recursive: true, force: true });
  console.log(`fidelity: the ops console at ${String(CONSOLE)} px`);
  const design = await openDesign(browser);
  await dispatch(browser, design);
  await pieces(browser, design);
  await photos(browser, design);
  await consents(browser, design);
  await referrals(browser, design);
  await waitlist(browser, design);
  await noShows(browser, design);
  await tasks(browser, design);
  await technicians(browser, design);
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
