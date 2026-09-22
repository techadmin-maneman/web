// The client app's fidelity pairs (docs/fidelity-method.md, "Phase 2 boards"):
// each frame of design/phase2/Client App.dc.html that P2-F1 builds, beside the
// built app in the same state, at the frames' 390 px.
//
//   npm run build:app -- --env local && npm run fidelity:app
//
// The app's API is answered with the design's own example (Rohit Malhotra, a
// consultation on Sat 21 Sep), so both sides show the same things. The phone's
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
import { pair, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
import { serveDirectory } from "./lib/static-server.ts";

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
  consultation: { date: "2030-09-21", window_label: "before noon", place: "Sector 65, Gurgaon 122018" },
};

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
async function openApp(browser: Browser, path: string, api: Api): Promise<Page> {
  // The app's policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: FRAME_HEIGHT - STATUS_BAR },
    bypassCSP: true,
    serviceWorkers: "block",
  });
  await page.clock.install();
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

/** One of board B3's three small frames, by its caption: Loading, Offline or Error. */
function stateFrame(design: Page, caption: string): Promise<Buffer> {
  return design
    .locator('[data-screen-label="Home · states"] > div')
    .filter({ has: design.getByText(caption, { exact: true }) })
    .screenshot();
}

async function shot(page: Page): Promise<Buffer> {
  await page.evaluate(() => document.fonts.ready);
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
  await loading.getByRole("status").filter({ hasText: "Loading" }).waitFor({ state: "attached" });
  await pair(OUT, WIDTH, "b3-loading", await stateFrame(design, "Loading"), await shot(loading));
  await loading.close();

  const offline = await openApp(browser, "/", { "/api/me": json(ME, { "Mm-Served-From": "cache" }) });
  await offline.getByText("No connection. Showing your last update.").waitFor();
  await pair(OUT, WIDTH, "b3-offline", await stateFrame(design, "Offline"), await shot(offline));
  await offline.close();

  const failed = await openApp(browser, "/", { "/api/me": (route) => route.abort() });
  await failed.getByRole("heading", { name: "We could not load your visit." }).waitFor();
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
  const cards = await app.screenshot({ fullPage: true, clip: { x: 0, y: top, width: WIDTH, height: bottom - top } });
  await pair(OUT, WIDTH, "g2-account", await frame(design, "Profile · account", false), cards);
  await app.close();
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
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
