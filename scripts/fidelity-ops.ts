// The ops console's fidelity pairs (docs/fidelity-method.md, "Phase 2 boards"):
// each frame of design/phase2/Ops Console.dc.html that P2-F4 builds, beside the
// built console in the same state. The console is drawn at 1440; boards C1 to
// C3 are panels within it, 660 and 484 px wide, drawn at their own size, so
// each pair is a panel beside a panel.
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

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "@playwright/test";
import { pair, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
import { serveDirectory } from "./lib/static-server.ts";

const OPS_DIR = resolve("apps/ops/dist/local");
const DESIGN_DIR = resolve("design/phase2");
const OPS = "http://127.0.0.1:4316";
const DESIGN = "http://127.0.0.1:4315/Ops%20Console.dc.html";
const OUT = resolve("docs/fidelity/ops");

/** The console's own width, and the two widths its panels are drawn at. */
const CONSOLE = 1440;
const QUEUE = 660;
const PANEL = 484;

/** The year the board's waiting dates fall in, so "4 Feb" needs no year. */
const IN_2027 = new Date("2027-09-22T05:00:00Z");

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

// ---- Pages -------------------------------------------------------------------

type Api = Readonly<Record<string, (route: Route) => Promise<void>>>;
const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });
const missing = (route: Route) => route.fulfill({ status: 404, json: { error: { code: "not_found" } } });

const API: Api = {
  "/api/referrals/held": json(HELD),
  "/api/referrers": json(REFERRERS),
  "/api/waitlist": json(AREAS),
  "/api/pincodes/400050/launch": json(PREVIEW),
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
async function openConsole(browser: Browser, path: string): Promise<Page> {
  // The console's policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({
    viewport: { width: CONSOLE, height: 900 },
    bypassCSP: true,
    serviceWorkers: "block",
  });
  await page.clock.install({ time: IN_2027 });
  await page.route("**/api/**", (route) => {
    const answer = API[new URL(route.request().url()).pathname] ?? missing;
    return answer(route);
  });
  await page.goto(`${OPS}${path}`);
  await settle(page);
  await page.addStyleTag({
    content: "#root > div { height: auto !important; } main { overflow: visible !important; }",
  });
  return page;
}

/** A frame of the board, by its label. */
const frame = (design: Page, label: string) => design.locator(`[data-screen-label="${label}"]`).screenshot();

// ---- The pairs ----------------------------------------------------------------

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

const servers: Server[] = [
  await serveDirectory(OPS_DIR, 4316, undefined, { spa: true }),
  await serveDirectory(DESIGN_DIR, 4315),
];
const browser = await chromium.launch();
try {
  rmSync(OUT, { recursive: true, force: true });
  console.log(`fidelity: the ops console at ${String(CONSOLE)} px`);
  const design = await openDesign(browser);
  await referrals(browser, design);
  await waitlist(browser, design);
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
