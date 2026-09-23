// The ops console's fidelity pairs (docs/fidelity-method.md, "Phase 2 boards"):
// each frame of design/phase2/Ops Console.dc.html that the console builds,
// beside the built console in the same state. The console is drawn at 1440;
// boards B2, B3, C1 to C3, D1 and D3 are panels within it, 660 and 484 px wide,
// drawn at their own size, so each pair is a panel beside a panel.
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
// Board A1 draws the console whole at 1440 and shows it at 1000, so its pair is
// the console's own frame brought down to 1000; every other pair is a panel
// beside a panel, at its own size.

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import { BOARD } from "../e2e/ops/fixtures.ts";
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
const held = (n: number, referrer: string, referred: string, fittedOn: string, signal: string) => ({
  id: `aa000000-0000-4000-8000-00000000000${String(n)}`,
  referrer: person(n, referrer),
  referred: person(n + 5, referred),
  fitted_on: fittedOn,
  signals: [signal],
});
const HELD = {
  held: [
    held(1, "Rohit Malhotra", "Vikram Sethi", "2027-09-19", "shared_address"),
    held(2, "Ashish Gill", "Manoj Gill", "2027-09-21", "shared_upi"),
    held(3, "Karan Bose", "Nikhil Arora", "2027-09-22", "monthly_cap"),
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

/** The board's own: checked in at 11:31, 240 m out, the WhatsApp delivered 11:32, closed at 11:47. */
const NO_SHOWS = {
  cases: [
    {
      id: "66000000-0000-4000-8000-000000000001",
      appointment_id: "77000000-0000-4000-8000-000000000001",
      visit_date: "2027-09-19",
      technician: "Imran Qureshi",
      checked_in_at: "2027-09-19T06:01:00.000Z",
      distance_m: 240,
      message_delivered_at: "2027-09-19T06:02:00.000Z",
      wait_ends_at: "2027-09-19T06:16:00.000Z",
      closed_at: "2027-09-19T06:17:00.000Z",
      decision: "undecided",
      decided_at: null,
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
  devices: [phone(`device-${String(n)}`, "Chrome on Android", seen)],
});
const TECHNICIANS = {
  technicians: [
    worker(1, "Imran Qureshi", "IQ", "Sec 40–65", "2027-09-22"),
    worker(2, "Sandeep Yadav", "SY", "Sec 1–39", "2027-09-22"),
    worker(3, "Arjun Negi", "AN", "DLF 1–5", "2027-09-21"),
    worker(4, "Faizan Ali", "FA", "Sohna Rd", "2027-09-20"),
  ],
};

const consent = (purpose: string, state: string, version: string | null, at: string | null) => ({
  purpose,
  state,
  notice_version: version,
  at,
});
const CONSENTS = {
  consents: [
    consent("photos_own_record", "given", "photos-own-record-v1", "2026-11-14T08:00:00.000Z"),
    consent("photos_referral_cards", "given", "photos-referral-cards-v2", "2027-08-03T08:00:00.000Z"),
    consent("photos_marketing", "not_given", null, null),
    consent("whatsapp_visits", "given", "whatsapp-visits-v1", "2026-11-02T08:00:00.000Z"),
    consent("whatsapp_launches", "withdrawn", "whatsapp-launches-v1", "2027-01-11T08:00:00.000Z"),
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
  // Boards A1 to A3 are answered with the week the browser tests use, so the
  // board's figures are written once and both read beside it (e2e/ops/fixtures.ts).
  "/api/dispatch": json(BOARD),
  "/api/referrals/held": json(HELD),
  "/api/referrers": json(REFERRERS),
  "/api/waitlist": json(AREAS),
  "/api/pincodes/400050/launch": json(PREVIEW),
  [`/api/clients/${CLIENT_ID}`]: json(RECORD),
  [`/api/clients/${CLIENT_ID}/photos`]: json(PHOTOS),
  [`/api/clients/${CLIENT_ID}/consents`]: json(CONSENTS),
  "/api/no-shows": json(NO_SHOWS),
  "/api/technicians": json(TECHNICIANS),
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
  const drawer = page.getByRole("dialog", { name: "Rohit M." });
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
 * Board D1. The board's frame draws the day's money over the charges, then the
 * disputed charge beside it; only the evidence and a ruling have a route, so
 * the queue is paired with the second card, the one that holds them.
 */
async function noShows(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/no-shows");
  const panel = page.getByRole("region", { name: "Waiting for a decision" });
  await panel.getByText("Delivered 11:32 am").waitFor();
  await pair(OUT, PANEL, "d1-no-shows", await panelOf(design, "Payments", 1), await panel.screenshot());
  await page.close();
}

/** Board D3, the roster, with each technician's phones beneath his name. */
async function technicians(browser: Browser, design: Page): Promise<void> {
  const page = await openConsole(browser, "/technicians");
  const panel = page.getByRole("region", { name: "Technicians" });
  await panel.getByText("Faizan Ali").waitFor();
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
  await photos(browser, design);
  await consents(browser, design);
  await referrals(browser, design);
  await waitlist(browser, design);
  await noShows(browser, design);
  await technicians(browser, design);
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
