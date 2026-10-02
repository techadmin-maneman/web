// The technician app's fidelity pairs (docs/fidelity-method.md, "The technician
// app"): each frame of design/phase2/Technician App.dc.html that P2-F4 builds,
// beside the built app in the same state, at the frames' 390 px.
//
//   npm run build:tech -- --env local && npm run fidelity:tech
//
// The app's API is answered with the design's own example — Imran's day, Rohit
// M.'s 9:30 service in Sector 65 — at the shapes `docs/openapi-tech.json`
// writes, so both sides show the same things. No mm-api runs, and no photograph
// of anyone is used.
//
// Writes docs/fidelity/technician-app/<name>.jpg: the design on the left, the
// build on the right. Differences in type, spacing, colour or order are defects.

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import { pair, rest, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
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

const ME = {
  name: "Imran Qureshi",
  first_name: "Imran",
  initials: "IQ",
  device: { device_id: "fidelity", label: "Chrome", enrolled_at: "2030-09-01T04:00:00.000Z" },
};

/** The design's day: 9:30, 11:30, 2:00 and 5:30, on a date the clock below is set to. */
const DAY = "2030-09-19";
const TOMORROW_DATE = "2030-09-20";

/** The slots each type takes (src/config/scheduling.ts): board A1 writes them beneath the time. */
const SLOTS: Readonly<Record<string, number>> = { consultation: 1, service: 1, replacement: 1.5, first_fit: 2 };

const job = (id: number, date: string, time: string, minutes: number, type: string, badge: string, sector: string) => ({
  id: `a0000000-0000-4000-8000-00000000000${String(id)}`,
  day: date === DAY ? "today" : "tomorrow",
  date,
  // India is five and a half hours ahead, so the board's clock is this instant plus 5:30.
  starts_at: `${date}T${time}:00.000Z`,
  ends_at: new Date(new Date(`${date}T${time}:00.000Z`).getTime() + minutes * 60_000).toISOString(),
  window_label: "morning",
  type,
  one_visit: false,
  product: null,
  sector,
  status: "scheduled",
  badge,
  slots: SLOTS[type] ?? 1,
  unlocked: true,
  unlocks_at: `${date}T00:00:00.000Z`,
});

const JOBS = [
  job(1, DAY, "04:00", 90, "service", "prepaid", "Sector 65"),
  job(2, DAY, "06:00", 90, "service", "credit", "DLF Phase 4"),
  job(3, DAY, "08:30", 180, "first_fit", "prepaid", "Sector 43"),
  job(4, DAY, "12:00", 60, "consultation", "free", "Sector 57"),
];

/** The board's collapsed line reads "Tomorrow · 3 jobs". */
const TOMORROW = [
  job(5, TOMORROW_DATE, "04:30", 90, "service", "prepaid", "Sector 50"),
  job(6, TOMORROW_DATE, "07:00", 90, "service", "credit", "Sector 56"),
  job(7, TOMORROW_DATE, "10:30", 135, "replacement", "prepaid", "Sector 49"),
];

const CLIENTS: Readonly<Record<string, string>> = {
  "a0000000-0000-4000-8000-000000000001": "Rohit M.",
  "a0000000-0000-4000-8000-000000000002": "Vikram S.",
  "a0000000-0000-4000-8000-000000000003": "Sanjay B.",
  "a0000000-0000-4000-8000-000000000004": "Nikhil A.",
};

const CHECKLIST = [
  { id: "piece_removed", label: "Remove" },
  { id: "base_cleaned", label: "Clean the base" },
  { id: "scalp_cleaned", label: "Clean the scalp" },
  { id: "re_taped", label: "Re-tape" },
  { id: "re_bonded", label: "Re-bond" },
  { id: "cut_and_styled", label: "Trim and style" },
];

const PARTIAL_REASONS = [
  { id: "client_stopped_it", label: "Client stopped it partway" },
  { id: "piece_not_ready", label: "The piece was not ready" },
  { id: "client_unwell", label: "Client unwell" },
  { id: "more_time_needed", label: "More time needed" },
];

/**
 * Board B3's four consumables, the counts it draws as what a service visit is expected to use. The one it draws at
 * nought is behind "Add another", which the board does not draw (docs/decisions/0087-consumables-and-stock.md).
 */
const CONSUMABLES = [
  { code: "tape_strips", name: "Tape strips", unit: "strip", expected: 6 },
  { code: "bonding_glue", name: "Bonding glue", unit: "ml", expected: 1 },
  { code: "solvent", name: "Solvent", unit: "ml", expected: 1 },
  { code: "shampoo_sachet", name: "Shampoo sachet", unit: "sachet", expected: 0 },
];

interface Progress {
  checked_in_at: string | null;
  wait_ends_at: string | null;
  distance_m: number | null;
  started_at: string | null;
  steps_done: string[];
  outcome: string | null;
}

const NOTHING_DONE: Progress = {
  checked_in_at: null,
  wait_ends_at: null,
  distance_m: null,
  started_at: null,
  steps_done: [],
  outcome: null,
};

/** Board A3's piece, as the card carries the client's pieces. */
const PIECE = {
  piece_code: "MM-STD-4417-B",
  base: "Mono",
  supplier_lot: "LOT-4417",
  fitted_at: "2030-07-02",
  replacement_due_at: "2030-12-29",
  failed_at: null,
  failure_reason: null,
};

/** A 1×1 grey PNG for board A3's last visit: no photograph of anyone is used. */
const LAST_VISIT_PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
  "base64",
);

const cardFor = (id: string, progress: Progress = NOTHING_DONE) => {
  const summary = [...JOBS, ...TOMORROW].find((one) => one.id === id) ?? JOBS[0];
  const takesPiece = summary?.type === "replacement" || summary?.type === "first_fit";
  return {
    ...summary,
    address: {
      line1: "Tower C, 14th floor",
      line2: null,
      building: null,
      tower: null,
      floor: null,
      flat: null,
      landmark: null,
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
      lat: 28.39,
      lng: 77.07,
    },
    access_notes: "Gate code 4417 · visitor bay B",
    client: { name: CLIENTS[id] ?? "", mobile: "+919810000000", note: null },
    progress,
    no_show_wait_min: 15,
    pieces: [PIECE],
    // Board A3's "Last visit, after. 22 Aug, Imran.", and board B5's "delivered 9:33 am".
    last_visit: { date: "2030-08-22", technician: "Imran", photo_url: `/api/tech/jobs/${id}/last-visit-photo` },
    reminder: { delivered_at: `${DAY}T04:03:00.000Z` },
    steps: takesPiece
      ? ["before_photos", "checklist", "consumables", "piece", "after_photos", "outcome"]
      : ["before_photos", "checklist", "consumables", "after_photos", "outcome"],
    checklist: CHECKLIST,
    partial_reasons: PARTIAL_REASONS,
    consumables: CONSUMABLES,
    products: [],
    payment_link: null,
  };
};

/** The clock: the day the jobs are on, at 9:12 India time, as board A1's status bar reads. */
const AT_912 = new Date(`${DAY}T03:42:00Z`);

type Api = Readonly<Record<string, (route: Route) => Promise<void>>>;

const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });
const signedOut = (route: Route) =>
  route.fulfill({ status: 401, json: { error: { code: "session_required", request_id: "fidelity" } } });

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
async function openApp(browser: Browser, path: string, api: Api, height = FRAME_HEIGHT - STATUS_BAR): Promise<Page> {
  // The app's policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({
    viewport: { width: WIDTH, height },
    bypassCSP: true,
    serviceWorkers: "block",
    // Board B5 checks the phone's position; the address's own coordinates stand in for it.
    permissions: ["geolocation"],
    geolocation: { latitude: 28.39, longitude: 77.07 },
  });
  await page.clock.install({ time: AT_912 });
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
  await rest(page);
  return page.screenshot();
}

// ---- The pairs ----------------------------------------------------------------

const dayApi = (jobs: unknown[], tomorrow: unknown[]): Api => ({
  "/api/tech/me": json(ME),
  "/api/tech/jobs": (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    return route.fulfill({ json: { date, jobs: date === DAY ? jobs : tomorrow } });
  },
  ...Object.fromEntries([...JOBS, ...TOMORROW].map((one) => [`/api/tech/jobs/${one.id}`, json(cardFor(one.id))])),
});

const jobApi = (id: string, progress: Progress = NOTHING_DONE): Api => ({
  "/api/tech/me": json(ME),
  [`/api/tech/jobs/${id}`]: json(cardFor(id, progress)),
  [`/api/tech/jobs/${id}/last-visit-photo`]: (route) =>
    route.fulfill({ contentType: "image/png", body: LAST_VISIT_PHOTO }),
  "/api/tech/jobs": json({ date: DAY, jobs: JOBS }),
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
  const app = await openApp(browser, `/jobs/${first.id}`, jobApi(first.id));
  await app.getByRole("button", { name: "I have arrived" }).waitFor();
  await pair(OUT, WIDTH, "a3-job", await frame(design, "Job detail"), await shot(app));
  await app.close();
}

/**
 * Board B5 is drawn as four stacked cards, and the app shows the one the job is
 * at, so each is paired against the whole column: arriving, the check-in that
 * failed, and the wait with its timer.
 */
async function notHome(browser: Browser, design: Page): Promise<void> {
  const first = JOBS[0];
  if (first === undefined) throw new Error("the day has no jobs");
  const board = await frame(design, "Not home", false);

  const arrived = await openApp(browser, `/jobs/${first.id}`, jobApi(first.id), FRAME_HEIGHT);
  await arrived.getByRole("button", { name: "I have arrived" }).waitFor();
  await pair(OUT, WIDTH, "b5-arrived", board, await shot(arrived));
  await arrived.close();

  // The board's "You are 1.4 km from the address."
  const away = await openApp(
    browser,
    `/jobs/${first.id}`,
    { ...jobApi(first.id), [`/api/tech/jobs/${first.id}/checkin`]: checkIn(false, 1400) },
    FRAME_HEIGHT,
  );
  await away.getByRole("button", { name: "I have arrived" }).click();
  await away.getByText("Check-in failed").waitFor();
  await settle(away);
  await pair(OUT, WIDTH, "b5-failed", board, await shot(away));
  await away.close();

  // The board's "11:42 left of 15 minutes": the clock is stopped at 9:12, so the count is fixed.
  const waiting = await openApp(
    browser,
    `/jobs/${first.id}`,
    { ...jobApi(first.id), [`/api/tech/jobs/${first.id}/checkin`]: checkIn(true, 40) },
    FRAME_HEIGHT,
  );
  await waiting.getByRole("button", { name: "I have arrived" }).click();
  await waiting.getByText("2 · Waiting").waitFor();
  await settle(waiting);
  await pair(OUT, WIDTH, "b5-waiting", board, await shot(waiting));
  await waiting.close();
}

/** The check-in the board draws: 200 m, a fifteen-minute wait, and 11:42 left of it. */
const checkIn = (passed: boolean, distanceM: number) => (route: Route) =>
  route.fulfill({
    json: {
      passed,
      distance_m: distanceM,
      radius_m: 200,
      checked_in_at: new Date(AT_912.getTime() - 3 * 60_000 - 18 * 1000).toISOString(),
      wait_ends_at: passed ? new Date(AT_912.getTime() + 11 * 60_000 + 42 * 1000).toISOString() : null,
      accepted: passed
        ? {
            event_id: "fidelity",
            replayed: false,
            fsm_write_state: "pending",
            progress: { ...NOTHING_DONE, checked_in_at: new Date(AT_912.getTime()).toISOString() },
          }
        : null,
    },
  });

/** Boards B2 to B4: the steps whose screens the design draws whole. */
async function steps(browser: Browser, design: Page): Promise<void> {
  const first = JOBS[0];
  if (first === undefined) throw new Error("the day has no jobs");
  const started = {
    ...NOTHING_DONE,
    checked_in_at: `${DAY}T03:44:00.000Z`,
    started_at: `${DAY}T02:20:00.000Z`,
    steps_done: ["before_photos"],
  };

  const checklist = await openApp(browser, `/jobs/${first.id}/checklist`, jobApi(first.id, started));
  await checklist.getByText("Service checklist").waitFor();
  // The board draws three of six ticked.
  for (const label of ["Remove", "Clean the base", "Clean the scalp"]) {
    await checklist.getByRole("button", { name: label }).click();
  }
  await settle(checklist);
  await pair(OUT, WIDTH, "b2-checklist", await frame(design, "Job · checklist"), await shot(checklist));
  await checklist.close();

  const consumables = await openApp(
    browser,
    `/jobs/${first.id}/consumables`,
    jobApi(first.id, { ...started, steps_done: [...started.steps_done, "checklist"] }),
    FRAME_HEIGHT,
  );
  await consumables.getByText("Consumables used").waitFor();
  await pair(OUT, WIDTH, "b3-consumables", await frame(design, "Job · consumables", false), await shot(consumables));
  await consumables.close();

  // The piece is a replacement's step, so it is paired on the day's replacement.
  const replacement = TOMORROW.find((one) => one.type === "replacement");
  if (replacement === undefined) throw new Error("no replacement to pair the piece on");
  const piece = await openApp(
    browser,
    `/jobs/${replacement.id}/piece`,
    {
      ...jobApi(replacement.id, { ...started, steps_done: [...started.steps_done, "checklist", "consumables"] }),
      "/api/tech/pieces/lookup": json({
        piece: {
          piece_code: "MM-STD-4417-B",
          base: "Mono",
          supplier_lot: "LOT-4417",
          fitted_at: null,
          replacement_due_at: null,
          failed_at: null,
          failure_reason: null,
        },
        belongs_to_this_job: true,
      }),
    },
    FRAME_HEIGHT,
  );
  await piece.getByRole("textbox", { name: "The new piece's label" }).fill("MM-STD-4417-B");
  await piece.getByRole("button", { name: "Check the label", exact: true }).click();
  // The lookup fills the base in, as the board's "Base · Mono" reads it.
  await piece.waitForFunction(() => document.querySelector<HTMLInputElement>("#piece-base")?.value === "Mono");
  await settle(piece);
  await pair(OUT, WIDTH, "b3-piece", await frame(design, "Job · consumables", false), await shot(piece));
  await piece.close();

  const outcomeBoard = await frame(design, "Job · outcome", false);
  const outcome = await openApp(
    browser,
    `/jobs/${first.id}/outcome`,
    jobApi(first.id, { ...started, steps_done: [...started.steps_done, "checklist", "consumables", "after_photos"] }),
    FRAME_HEIGHT,
  );
  await outcome.getByText("Outcome").first().waitFor();
  await outcome.getByRole("button", { name: "Partial · pick a reason" }).click();
  await settle(outcome);
  await pair(OUT, WIDTH, "b4-outcome", outcomeBoard, await shot(outcome));
  await outcome.close();

  // The close-out, which the board draws beneath the outcome and the app shows after it.
  const closedOut = {
    ...started,
    steps_done: [...started.steps_done, "checklist", "consumables", "after_photos", "outcome"],
    outcome: "done",
  };
  // The outcome lands, so the close-out is the one the board draws and not the sign-in an unanswered write would end in.
  const landed = json({ event_id: "fidelity", replayed: false, fsm_write_state: "pending", progress: closedOut });
  const done = await openApp(
    browser,
    `/jobs/${first.id}/outcome`,
    { ...jobApi(first.id, closedOut), [`/api/tech/jobs/${first.id}/outcome`]: landed },
    FRAME_HEIGHT,
  );
  await done.getByText("Outcome").first().waitFor();
  // Nothing is chosen for the technician: Done first, then Next, once the step has slid in and takes a tap.
  await done.getByRole("button", { name: "Done", exact: true }).click();
  await done.clock.runFor(400);
  await done.getByRole("button", { name: "Next" }).click();
  await done.getByText("Closed out").waitFor();
  await settle(done);
  await pair(OUT, WIDTH, "b4-closed-out", outcomeBoard, await shot(done));
  await done.close();
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
  await notHome(browser, design);
  await steps(browser, design);
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
