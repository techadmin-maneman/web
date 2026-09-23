// The referral landing's fidelity pairs (docs/fidelity-method.md, "Phase 2
// boards"): each Landing frame of design/phase2/Referral and Waitlist.dc.html
// beside the built page in the same state, at the frames' 390 px, and the
// desktop board at 1440.
//
//   npm run build:site -- --env local && npm run fidelity:refer
//
// The page's API is answered with the design's own example — Rohit's invite,
// Sector 65 for 122018 and Bandra for 400050 — so both sides show the same
// things. Every /r/:code is the one built page (docs/decisions/0027-referral-landing.md);
// ?state= opens each state, as it does for the booking form.
//
// Writes docs/fidelity/referral/<name>.jpg: the design on the left, the build
// on the right. Differences in type, spacing, colour or order are defects.

import { rmSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { pair, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
import { serveDirectory } from "./lib/static-server.ts";

const SITE_DIR = resolve("site/dist/local");
const DESIGN_DIR = resolve("design/phase2");
const SITE = "http://127.0.0.1:4315";
const DESIGN = "http://127.0.0.1:4316/Referral%20and%20Waitlist.dc.html";
const OUT = resolve("docs/fidelity/referral");

const PHONE = 390;
const DESKTOP = 1440;
const STATUS_BAR = 44;
/** The design's own code, as its boards draw the link. */
const CODE = "RM4K7P";
const HOUSE_CARD_FILE = resolve("site/public/images/invite-house.jpg");

const INVITE = {
  state: "valid",
  referrer_first_name: "Rohit",
  card: { state: "personal", version: 1 },
};
const PINCODES: Readonly<Record<string, unknown>> = {
  "122018": { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" },
  "400050": { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" },
};

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STILL });
  await page.waitForTimeout(250);
}

async function openDesign(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await routeDesignLibraries(page);
  await page.goto(DESIGN, { waitUntil: "networkidle" });
  await page.locator('[data-screen-label="Landing · arrival"]').waitFor();
  await settle(page);
  return page;
}

/** The landing with its API answered from the design's example. */
async function openSite(browser: Browser, width: number, state: string | null): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width, height: width === PHONE ? 844 - STATUS_BAR : 900 },
    // The site's policy would refuse the style that stills the page.
    bypassCSP: true,
  });
  await page.route("**/api/r/*", (route) => route.fulfill({ json: INVITE }));
  await page.route("**/api/pincodes/*", (route) => {
    const pin = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    return route.fulfill({ json: PINCODES[pin] ?? { pincode: pin, served: false, area: null, city: null } });
  });
  // The invite's preview comes from mm-api; here the site's own house card stands in for it.
  await page.route("**/api/og/*", (route) => route.fulfill({ contentType: "image/jpeg", path: HOUSE_CARD_FILE }));
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.goto(`${SITE}/r/${CODE}${state === null ? "" : `?state=${state}`}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  await settle(page);
  return page;
}

/** A frame of the board, with the phone's status bar cropped off. */
async function frame(design: Page, label: string, statusBar = true): Promise<Buffer> {
  const shot = await design.locator(`[data-screen-label="${label}"]`).screenshot();
  if (!statusBar) return shot;
  const { width, height } = await sharp(shot).metadata();
  return sharp(shot)
    .extract({ left: 0, top: STATUS_BAR, width, height: height - STATUS_BAR })
    .toBuffer();
}

/** One of the confirmations board's small frames, by its caption. */
function stateFrame(design: Page, caption: string): Promise<Buffer> {
  return design
    .locator('[data-screen-label="Landing · confirmations"] > div')
    .filter({ has: design.getByText(caption, { exact: true }) })
    .screenshot();
}

const shot = (page: Page) => page.screenshot({ fullPage: true });

const servers: Server[] = [await serveDirectory(SITE_DIR, 4315), await serveDirectory(DESIGN_DIR, 4316)];
const browser = await chromium.launch();
try {
  rmSync(OUT, { recursive: true, force: true });
  const design = await openDesign(browser);

  const arrival = await openSite(browser, PHONE, null);
  await pair(OUT, PHONE, "c1-arrival", await frame(design, "Landing · arrival"), await shot(arrival));
  await arrival.close();

  const served = await openSite(browser, PHONE, "served");
  await pair(OUT, PHONE, "c2-served", await frame(design, "Landing · served"), await shot(served));
  await served.close();

  const unserved = await openSite(browser, PHONE, "unserved");
  await pair(OUT, PHONE, "c3-not-served", await frame(design, "Landing · not served"), await shot(unserved));
  await unserved.close();

  const booked = await openSite(browser, PHONE, "booked");
  await pair(OUT, PHONE, "c4-booked", await stateFrame(design, "Consultation booked"), await shot(booked));
  await booked.close();

  const listed = await openSite(browser, PHONE, "listed");
  await pair(OUT, PHONE, "c4-on-the-list", await stateFrame(design, "On the list"), await shot(listed));
  await listed.close();

  const desktop = await openSite(browser, DESKTOP, null);
  await pair(OUT, DESKTOP, "c5-desktop", await frame(design, "Landing · desktop", false), await shot(desktop));
  await desktop.close();

  await design.close();
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
