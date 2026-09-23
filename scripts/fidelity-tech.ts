// The technician app's fidelity pairs (docs/fidelity-method.md, "The technician
// app"): each frame of design/phase2/Technician App.dc.html that P2-F4 builds,
// beside the built app in the same state, at the frames' 390 px.
//
//   npm run build:tech -- --env local && npm run fidelity:tech
//
// The app's API is answered with the design's own example — Imran's four jobs,
// Rohit M.'s 9:30 service in Sector 65 — so both sides show the same things. No
// mm-api runs, and no photograph of anyone is used: last visit's thumbnail is a
// block of ink, as the client app's pairs draw theirs.
//
// Writes docs/fidelity/technician-app/<name>.jpg: the design on the left, the
// build on the right. Differences in type, spacing, colour or order are defects.

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import { pair, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
import { serveDirectory } from "./lib/static-server.ts";

const APP_DIR = resolve("apps/tech/dist/local");
const DESIGN_DIR = resolve("design/phase2");
const APP = "http://127.0.0.1:4316";
const DESIGN = "http://127.0.0.1:4315/Technician%20App.dc.html";
const OUT = resolve("docs/fidelity/technician-app");

const WIDTH = 390;
const FRAME_HEIGHT = 844;
const STATUS_BAR = 44;

// ---- The design's example, as the API would answer it -------------------------

const ME = { technician: { name: "Imran Qureshi", initials: "IQ" }, device: { id: "fidelity", label: "Chrome" } };

/** The design's day: 9:30, 11:30, 2:00 and 5:30, on a date the clock below is set to. */
const DAY = "2030-09-19";
const job = (
  id: number,
  time: string,
  slots: number,
  type: string,
  badge: string,
  client_name: string,
  sector: string,
  distance_km: number,
) => ({
  id: `a0000000-0000-4000-8000-00000000000${String(id)}`,
  // India is five and a half hours ahead, so the board's clock is this instant minus 5:30.
  starts_at: `${DAY}T${time}:00.000Z`,
  slots,
  type,
  badge,
  client_name,
  sector,
  distance_km,
  locked: false,
});

const JOBS = [
  job(1, "04:00", 1, "service", "prepaid", "Rohit M.", "Sector 65", 3.1),
  job(2, "06:00", 1, "service", "credit", "Vikram S.", "DLF Phase 4", 5.4),
  job(3, "08:30", 2, "first_fit", "prepaid", "Sanjay B.", "Sector 43", 7.2),
  job(4, "12:00", 1, "consultation", "free", "Nikhil A.", "Sector 57", 4.8),
];

/** The board's collapsed line reads "Tomorrow · 3 jobs". */
const TOMORROW = [
  job(5, "04:30", 1, "service", "prepaid", "Arjun T.", "Sector 50", 2.2),
  job(6, "07:00", 1, "service", "credit", "Deepak R.", "Sector 56", 3.8),
  job(7, "10:30", 1, "replacement", "prepaid", "Manish K.", "Sector 49", 6.1),
];

const CARD = {
  ...JOBS[0],
  address: { line: "Sector 65, Gurgaon 122018", access_notes: "Gate code 4417 · visitor bay B" },
  spec: [
    { key: "Tier", value: "Standard" },
    { key: "Base", value: "Mono" },
    { key: "Colour", value: "1B / 20% grey" },
    { key: "Adhesive", value: "Tape · blue liner" },
    { key: "Template", value: "RM-4417-v2" },
    { key: "Scalp", value: "Dry at the crown" },
  ],
  last_visit: { photo_url: "/fidelity-thumb.png", on: "22 Aug", technician: "Imran" },
  started_at: null,
};

/** The design's thumbnail is a photograph; the pair uses a block of the same ink. */
const THUMB = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#131c2e" } })
  .png()
  .toBuffer();

/** The clock: the day the jobs are on, at 9:12 India time, as board A1's status bar reads. */
const AT_912 = new Date(`${DAY}T03:42:00Z`);

type Api = Readonly<Record<string, (route: Route) => Promise<void>>>;

const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });
const signedOut = (route: Route) =>
  route.fulfill({ status: 401, json: { error: { code: "unauthorised", message: "Sign in to continue." } } });

// ---- Pages ------------------------------------------------------------------

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STILL });
  await page.evaluate(() => document.fonts.ready);
}

async function openDesign(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await routeDesignLibraries(page);
  await page.goto(DESIGN, { waitUntil: "networkidle" });
  await page.locator('[data-screen-label="Job detail"]').waitFor();
  await settle(page);
  return page;
}

/** The app with its API answered from `api` (anything else unauthorised), 44 px shorter than a frame. */
async function openApp(browser: Browser, path: string, api: Api): Promise<Page> {
  // The app's policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: FRAME_HEIGHT - STATUS_BAR },
    bypassCSP: true,
    serviceWorkers: "block",
  });
  await page.clock.install({ time: AT_912 });
  await page.route("**/fidelity-thumb.png", (route) => route.fulfill({ body: THUMB, contentType: "image/png" }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const answer = api[url.pathname] ?? signedOut;
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

async function shot(page: Page): Promise<Buffer> {
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot();
}

// ---- The pairs ----------------------------------------------------------------

const dayApi = (jobs: unknown[], tomorrow: unknown[]): Api => ({
  "/api/tech/me": json(ME),
  "/api/tech/jobs": (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    return route.fulfill({ json: { date, jobs: date === DAY ? jobs : tomorrow } });
  },
});

async function today(browser: Browser, design: Page): Promise<void> {
  const app = await openApp(browser, "/", dayApi(JOBS, TOMORROW));
  await app.getByRole("heading", { name: "4 jobs today" }).waitFor();
  await pair(OUT, WIDTH, "a1-today", await frame(design, "Today"), await shot(app));
  await app.close();

  const empty = await openApp(browser, "/", dayApi([], TOMORROW));
  await empty.getByText("Nothing booked for today").waitFor();
  const emptyFrame = design
    .locator('[data-screen-label="Today · states"] > div')
    .filter({ has: design.getByText("Nothing booked for today", { exact: true }) })
    .screenshot();
  await pair(OUT, WIDTH, "a2-empty", await emptyFrame, await shot(empty));
  await empty.close();
}

async function jobCard(browser: Browser, design: Page): Promise<void> {
  const first = JOBS[0];
  if (first === undefined) throw new Error("the day has no jobs");
  const app = await openApp(browser, `/jobs/${first.id}`, {
    "/api/tech/me": json(ME),
    [`/api/tech/jobs/${first.id}`]: json(CARD),
  });
  await app.getByRole("button", { name: "Start job" }).waitFor();
  await pair(OUT, WIDTH, "a3-job", await frame(design, "Job detail"), await shot(app));
  await app.close();
}

const servers: Server[] = [
  await serveDirectory(APP_DIR, 4316, undefined, { spa: true }),
  await serveDirectory(DESIGN_DIR, 4315),
];
const browser = await chromium.launch();
try {
  rmSync(OUT, { recursive: true, force: true });
  console.log(`fidelity: the technician app at ${String(WIDTH)} px`);
  const design = await openDesign(browser);
  await today(browser, design);
  await jobCard(browser, design);
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
