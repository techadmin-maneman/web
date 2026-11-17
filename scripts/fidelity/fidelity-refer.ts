// The referral landing's fidelity pairs (docs/fidelity-method.md, "The referral landing"). The landing has no board of
// its own: it is /book's island with an invite (ADR 0265), so each of its states pairs with /book's board
// (design/site-redesign/boards) walked to the step that draws the same thing, at the boards' 390 and 1440 px: the
// pincode (the board's area step), a served pincode (the visit), one not served (the list), on the list, and booked.
//
//   npm run build:site -- --env local && npm run fidelity:refer
//
// The page's API is answered with the design's own example — Rohit's invite, Sector 65 for 122018 and Bandra for
// 400050 — so both sides show the same things. Every /r/:code is the one built page
// (docs/decisions/0027-referral-landing.md); ?state= opens each state, as it does for the booking form.
//
// Writes docs/fidelity/referral/<width>/<name>.jpg: the design on the left, the build on the right. Differences in
// type, spacing, colour or order are defects, but for what the landing has and /book does not: who sent it, the card,
// and its offer.

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { pair } from "../lib/fidelity.ts";
import { bookBoardAt, openBoard, preparePage, settle, type BookBoardState } from "../lib/site-boards.ts";
import { serveDirectory } from "../lib/static-server.ts";
/** Where the site keeps the cookie bar's answer (site/src/lib/analytics.ts). */
const CONSENT_KEY = "mm-ad-consent";

const SITE_DIR = resolve("site/dist/local");
const DESIGN_DIR = resolve("design");
const SITE = "http://127.0.0.1:4315";
const DESIGN = "http://127.0.0.1:4316/site-redesign/boards";
const OUT = resolve("docs/fidelity/referral");

/** The design's own code, as the phase 2 boards drew the link. */
const CODE = "RM4K7P";
const HOUSE_CARD_FILE = resolve("site/public/images/invite-house.jpg");

const INVITE = {
  state: "valid",
  referrer_first_name: "Rohit",
  card: { state: "personal", version: 1 },
};
/**
 * Friday 20 September 2030 in India, so the page's tomorrow is a Saturday on every run: the booked confirmation is
 * dated tomorrow (site/src/islands/invite/preview.ts).
 */
const THE_BOARDS_EVE = new Date("2030-09-20T05:00:00Z");
const PINCODES: Readonly<Record<string, unknown>> = {
  "122018": { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" },
  "400050": { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" },
};

/** Each of the landing's states, its ?state= (none as it opens), and the board's step that draws it. */
const STATES: readonly { name: string; preview: string | null; board: BookBoardState }[] = [
  { name: "arrival", preview: null, board: "area" },
  { name: "served", preview: "served", board: "visit" },
  { name: "not-served", preview: "unserved", board: "nots" },
  { name: "on-the-list", preview: "listed", board: "listed" },
  { name: "booked", preview: "booked", board: "done" },
];

const WIDTHS = [
  { width: 390, height: 844, prefix: "Phone" },
  { width: 1440, height: 900, prefix: "Laptop" },
] as const;

/** The landing in a state, with its API answered from the design's example. */
async function openLanding(page: Page, preview: string | null): Promise<void> {
  await page.goto(`${SITE}/r/${CODE}${preview === null ? "" : `?state=${preview}`}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  await settle(page);
}

async function landingPage(browser: Browser, width: number, height: number): Promise<Page> {
  const page = await preparePage(browser, DESIGN, width, height);
  await page.clock.install({ time: THE_BOARDS_EVE });
  // The cookie bar answered, as the boards draw none.
  await page.addInitScript((key) => {
    localStorage.setItem(key, "denied");
  }, CONSENT_KEY);
  await page.route("**/api/r/*", (route) => route.fulfill({ json: INVITE }));
  await page.route("**/api/pincodes/*", (route) => {
    const pin = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    return route.fulfill({ json: PINCODES[pin] ?? { pincode: pin, served: false, area: null, city: null } });
  });
  // The invite's preview comes from mm-api; here the site's own house card stands in for it.
  await page.route("**/api/og/*", (route) => route.fulfill({ contentType: "image/jpeg", path: HOUSE_CARD_FILE }));
  return page;
}

const servers: Server[] = [await serveDirectory(SITE_DIR, 4315), await serveDirectory(DESIGN_DIR, 4316)];
const browser = await chromium.launch();
try {
  rmSync(OUT, { recursive: true, force: true });
  for (const { width, height, prefix } of WIDTHS) {
    const design = await preparePage(browser, DESIGN, width, height);
    const landing = await landingPage(browser, width, height);
    for (const state of STATES) {
      await openBoard(design, DESIGN, `${prefix}Book`, (board) => bookBoardAt(board, state.board));
      await openLanding(landing, state.preview);
      const drawn = design.locator(".mm:visible").first();
      await pair({
        dir: `${OUT}/${String(width)}`,
        width,
        name: state.name,
        design: await drawn.screenshot(),
        built: await landing.screenshot({ fullPage: true }),
      });
    }
    await design.close();
    await landing.close();
  }
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
