// The site's fidelity pairs (docs/fidelity-method.md, "The site"): each board of the approved redesign
// (design/site-redesign/boards, ADR 0262) beside the built page, at the board's own width: the home page section by
// section, its header and footer, and every other page whole.
//
//   npm run build:site -- --env local && npm run fidelity
//
// The boards run on the design canvas's runtime (design/support.js) with React and Babel from unpkg, answered from
// node_modules. Their pictures are the canvas's /_blob/<id> files, answered from the repository's own files as
// design/site-redesign/README.md maps them. Video is blocked on both sides, so both show the poster. A board is drawn
// at a phone's or a laptop's height with its page scrolling inside; the run unrolls it to its full length.
//
// Writes docs/fidelity/site/<width>/<name>.jpg: the design on the left, the build on the right. Differences in type,
// spacing, colour or order are defects. Each pair it makes is replaced; nothing else in docs/fidelity is touched.
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { pair as pairIn, routeDesignLibraries, STILL } from "../lib/fidelity.ts";
import { serveDirectory } from "../lib/static-server.ts";

const SITE_DIR = resolve("site/dist/local");
const DESIGN_DIR = resolve("design");
const SITE = "http://127.0.0.1:4311";
const DESIGN = "http://127.0.0.1:4312/site-redesign/boards";
const OUT = resolve("docs/fidelity/site");

/** Each board's picture, from the README's table: `| \`<id>\` | \`<file>` …`. */
const BLOBS: ReadonlyMap<string, string> = new Map(
  [...readFileSync("design/site-redesign/README.md", "utf8").matchAll(/^\| `([0-9a-f]{32})` \| `([^` (]+)/gm)].map(
    (match) => [match[1] ?? "", match[2] ?? ""],
  ),
);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
};

/**
 * The home boards' sections, in order, and the build's section each pairs with. The board's guarantee and founder are
 * one section; its "at your own table" closes How it works (ADR 0263).
 */
const HOME_SECTIONS = [
  "hero",
  "results",
  "what",
  "norwood",
  "comparison",
  "teaser",
  "how",
  "range",
  "guarantee",
  "faq",
  "closing",
] as const;

/** Every other board and the page it draws, at both widths. */
const PAGES: readonly { board: string; path: string }[] = [
  { board: "Book", path: "/book" },
  { board: "Try", path: "/try" },
  { board: "Guides", path: "/guides" },
  { board: "Areas", path: "/areas" },
  { board: "Aftercare", path: "/aftercare" },
  { board: "Privacy", path: "/privacy" },
  { board: "Terms", path: "/terms" },
  { board: "OfferTerms", path: "/offer-terms" },
  { board: "Notices", path: "/notices" },
  { board: "Stop", path: "/stop" },
  { board: "NotFound", path: "/no-such-page" },
];

const WIDTHS = [
  { width: 390, height: 844, home: "Main", prefix: "Phone" },
  { width: 1440, height: 900, home: "LaptopHome", prefix: "Laptop" },
] as const;

async function preparePage(browser: Browser, width: number, height: number): Promise<Page> {
  // The site's content security policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({ viewport: { width, height }, bypassCSP: true });
  await page.route("**/*.mp4", (route) => route.abort());
  // The try-on readies Turnstile as it opens; here it gets one that passes.
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'window.turnstile = { render: () => "fake", reset() {} };' }),
  );
  await routeDesignLibraries(page);
  // The boards load the canvas's runtime beside them; it is the one in design/.
  await page.route(`${DESIGN}/support.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync("design/support.js") }),
  );
  await page.route("**/_blob/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const file = BLOBS.get(id);
    if (file === undefined || file.endsWith(".mp4")) return route.abort();
    return route.fulfill({
      body: readFileSync(file),
      contentType: CONTENT_TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream",
    });
  });
  return page;
}

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STILL });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Load every lazy image: walk down the page, then back to the top.
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 40));
    }
    window.scrollTo(0, 0);
    // Every image settles, loaded or not, within five seconds.
    const images = [...document.images]
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise((done) => {
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
          }),
      );
    await Promise.race([Promise.all(images), new Promise((done) => setTimeout(done, 5000))]);
  });
}

/** Opens a board and unrolls it: the board's frame and the page scrolling inside it take their full length. */
async function openBoard(page: Page, board: string): Promise<void> {
  await page.goto(`${DESIGN}/${board}.dc.html`, { waitUntil: "networkidle" });
  await page.locator(".mm:visible").first().waitFor();
  await page.evaluate(() => {
    const root = [...document.querySelectorAll<HTMLElement>(".mm")].find(
      (element) => element.getClientRects().length > 0,
    );
    if (root === undefined) return;
    // At least the board's own height, where its page is shorter than the screen it is drawn on.
    root.style.minHeight = `${String(root.getBoundingClientRect().height)}px`;
    root.style.height = "auto";
    root.style.overflow = "visible";
    // The page's own scroller is screen-tall; a row of cards or a table that scrolls inside it is not.
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(element);
      const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      if (!scrolls || element.clientHeight < 300) continue;
      const top = element.offsetTop;
      element.style.position = "static";
      element.style.overflow = "visible";
      element.style.height = "auto";
      element.style.flex = "none";
      if (style.position === "absolute") element.style.marginTop = `${String(top)}px`;
    }
  });
  await settle(page);
}

async function openSite(page: Page, path: string): Promise<void> {
  await page.goto(`${SITE}${path}`, { waitUntil: "networkidle" });
  await settle(page);
}

/** Hides (or shows again) everything with position: fixed. */
async function fixedBars(page: Page, visible: boolean): Promise<void> {
  await page.evaluate((show) => {
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(element).position === "fixed" || element.dataset.fidelityFixed === "1") {
        element.dataset.fidelityFixed = "1";
        element.style.visibility = show ? "" : "hidden";
      }
    }
  }, visible);
}

/** An element's screenshot, or null where the page has no such element. */
async function shoot(page: Page, selector: string): Promise<Buffer | null> {
  const element = page.locator(selector).first();
  if ((await element.count()) === 0) return null;
  await element.scrollIntoViewIfNeeded();
  return element.screenshot();
}

/** The two screenshots side by side, or a line saying which side has nothing to show. */
async function pair(width: number, name: string, design: Buffer | null, built: Buffer | null): Promise<void> {
  if (design === null || built === null) {
    console.log(`fidelity: ${String(width)} px ${name}: ${design === null ? "no board" : "nothing built"} to pair`);
    return;
  }
  await pairIn({ dir: `${OUT}/${String(width)}`, width, name, design, built });
}

async function run(browser: Browser, frame: (typeof WIDTHS)[number]): Promise<void> {
  const { width, height, home, prefix } = frame;
  const design = await preparePage(browser, width, height);
  const site = await preparePage(browser, width, height);

  // Home, section by section, then the header and the footer.
  await openBoard(design, home);
  await openSite(site, "/");
  await pair(width, "home-00-header", await shoot(design, ".mm > header"), await shoot(site, "body > header"));
  await fixedBars(site, false);
  for (const [index, name] of HOME_SECTIONS.entries()) {
    await pair(
      width,
      `home-${String(index + 1).padStart(2, "0")}-${name}`,
      await shoot(design, `.mm section >> nth=${String(index)}`),
      await shoot(site, `main > [data-section="${name}"]`),
    );
  }
  await pair(width, "home-12-footer", await shoot(design, ".mm footer"), await shoot(site, "body > footer"));

  // Every other page, as far down as its board draws it: a legal page's board holds a few of its clauses, where the
  // build holds them all.
  for (const { board, path } of PAGES) {
    await openBoard(design, `${prefix}${board}`);
    await openSite(site, path);
    await fixedBars(site, false);
    const name = board.replace(/[A-Z]/g, (letter, at: number) => (at === 0 ? "" : "-") + letter.toLowerCase());
    const drawn = design.locator(".mm:visible").first();
    const boardHeight = (await drawn.boundingBox())?.height ?? height;
    const pageHeight = await site.evaluate(() => document.documentElement.scrollHeight);
    await pair(
      width,
      `page-${name}`,
      await drawn.screenshot(),
      await site.screenshot({ fullPage: true, clip: { x: 0, y: 0, width, height: Math.min(boardHeight, pageHeight) } }),
    );
  }

  await design.close();
  await site.close();
}

const servers: Server[] = [await serveDirectory(SITE_DIR, 4311), await serveDirectory(DESIGN_DIR, 4312)];
const browser = await chromium.launch();
try {
  for (const frame of WIDTHS) {
    console.log(`fidelity: ${String(frame.width)} px`);
    await run(browser, frame);
  }
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
