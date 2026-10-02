// The visual comparison harness: the design (design/Mane Man Site v2.dc.html)
// and the built site side by side, section by section, at 390 and 1440 px.
//
//   npm run build:site -- --env local && npm run fidelity
//
// The design is a prototype that fetches React, ReactDOM and Babel from unpkg;
// those requests are answered from the same versions in node_modules. Video
// is blocked on both sides, so both show the poster. Fixed bars are hidden
// while sections are shot, and shot on their own.
//
// Writes docs/fidelity/<width>/<nn>-<name>.jpg: the design on the left, the
// build on the right. Differences in type, spacing, colour or order are defects.
// Each pair it makes is replaced; nothing else in docs/fidelity is touched.
import type { Server } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { pair as pairIn, routeDesignLibraries, STILL } from "./lib/fidelity.ts";
import { serveDirectory } from "./lib/static-server.ts";

const WIDTHS = [390, 1440] as const;
const SITE_DIR = resolve("site/dist/local");
const DESIGN_DIR = resolve("design");
const SITE = "http://127.0.0.1:4311";
const DESIGN = "http://127.0.0.1:4312/Mane%20Man%20Site%20v2.dc.html";
const OUT = resolve("docs/fidelity");

/**
 * The home page's sections, in order: v2's top-level blocks pair with these. v2's two bases pair with Materials and
 * construction, which took their place, and its prices with nothing while the site gives none (ADR 0103).
 */
const HOME_SECTIONS = [
  "hero",
  "what",
  "norwood",
  "comparison",
  "teaser",
  "discretion",
  "how",
  "technicians",
  "materials",
  null,
  "testimonials",
  "guarantee",
  "faq",
  "closing",
] as const;

async function preparePage(browser: Browser, width: number): Promise<Page> {
  // The site's content security policy would refuse the style that stills the page; screenshots set it aside.
  const page = await browser.newPage({ viewport: { width, height: 900 }, bypassCSP: true });
  await page.route("**/*.mp4", (route) => route.abort());
  // The try-on readies Turnstile as it opens; here it gets one that passes.
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'window.turnstile = { render: () => "fake", reset() {} };' }),
  );
  await routeDesignLibraries(page);
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

async function openDesign(page: Page): Promise<void> {
  await page.goto(DESIGN, { waitUntil: "networkidle" });
  await page.getByText("Hair, fitted at your home across Delhi NCR.").waitFor();
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

/** Marks v2's top-level home blocks data-fidelity="0".."13", and its footer. */
async function markDesign(page: Page): Promise<void> {
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1")].find((h1) => h1.textContent.startsWith("Hair, fitted"));
    let block: Element | null | undefined = heading;
    while (block?.parentElement && block.parentElement.children.length < 10) block = block.parentElement;
    [...(block?.parentElement?.children ?? [])].forEach((child, index) => {
      child.setAttribute("data-fidelity", String(index));
    });
    const entity = [...document.querySelectorAll("span")].find((span) =>
      span.textContent.includes("Grooming Services"),
    );
    let footer: HTMLElement | null | undefined = entity;
    while (footer && getComputedStyle(footer).marginTop === "0px") footer = footer.parentElement;
    footer?.setAttribute("data-fidelity", "footer");
  });
}

async function shoot(page: Page, selector: string | null): Promise<Buffer> {
  if (selector === null) return page.screenshot({ fullPage: true });
  const element = page.locator(selector).first();
  await element.scrollIntoViewIfNeeded();
  return element.screenshot();
}

/** The two screenshots side by side, in docs/fidelity/<width>. */
function pair(width: number, name: string, design: Buffer, built: Buffer): Promise<void> {
  return pairIn(`${OUT}/${String(width)}`, width, name, design, built);
}

// ---- The screens ------------------------------------------------------------

/** A design screen to click through to, and the build's screen it pairs with; null where the build has none. */
type Step = { name: string; design: (page: Page) => Promise<void>; site: string | null };

const click = (text: string) => async (page: Page) => {
  await page.getByText(text, { exact: true }).first().click();
};

const TRY_ON_STEPS: Step[] = [
  { name: "try-1-upload", design: click("See yourself with hair"), site: "/try" },
  { name: "try-2-consent", design: click("Choose a photograph"), site: "/try?state=consent" },
  {
    name: "try-3-stage",
    design: async (page) => {
      await page.getByText("I understand, and I agree to my photograph being used this way.").click();
      await click("Continue")(page);
    },
    site: "/try?state=stage",
  },
  { name: "try-4-looks", design: click("Continue"), site: "/try?state=looks" },
  // The look goes to WhatsApp only (ADR 0104): the build has no countdown before the gate, and no result after it.
  {
    name: "try-5-processing",
    design: async (page) => {
      await page.getByText("Full density", { exact: true }).first().click();
      await click("Generate the simulation")(page);
    },
    site: null,
  },
  {
    name: "try-6-gate",
    design: async (page) => {
      await page.getByText("Where should we send it?").waitFor({ timeout: 30_000 });
    },
    site: "/try?state=gate",
  },
];

async function run(browser: Browser, width: number): Promise<void> {
  const design = await preparePage(browser, width);
  const site = await preparePage(browser, width);

  // Home, section by section, then the fixed header and bar, then the footer.
  await openDesign(design);
  await markDesign(design);
  await openSite(site, "/");
  await fixedBars(design, false);
  await fixedBars(site, false);
  for (const [index, name] of HOME_SECTIONS.entries()) {
    if (name === null) continue;
    await pair(
      width,
      `home-${String(index + 1).padStart(2, "0")}-${name}`,
      await shoot(design, `[data-fidelity="${String(index)}"]`),
      await shoot(site, `main > [data-section="${name}"]`),
    );
  }
  await pair(width, "home-15-footer", await shoot(design, `[data-fidelity="footer"]`), await shoot(site, "footer"));
  for (const page of [design, site]) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await fixedBars(page, true);
  }
  const top = { x: 0, y: 0, width, height: 56 };
  await pair(width, "chrome-header", await design.screenshot({ clip: top }), await site.screenshot({ clip: top }));
  const bottom = { x: 0, y: 900 - 64, width, height: 64 };
  await pair(
    width,
    "chrome-sticky-bar",
    await design.screenshot({ clip: bottom }),
    await site.screenshot({ clip: bottom }),
  );

  // The try-on: the design is clicked through; the build opens each screen.
  await openDesign(design);
  for (const step of TRY_ON_STEPS) {
    await step.design(design);
    if (step.site === null) continue;
    await settle(design);
    await openSite(site, step.site);
    await pair(width, step.name, await shoot(design, null), await shoot(site, null));
  }
  await openDesign(design);
  await click("See yourself with hair")(design);
  await click("See what happens if the photo will not work")(design);
  await settle(design);
  await openSite(site, "/try?state=error");
  await pair(width, "try-8-error", await shoot(design, null), await shoot(site, null));

  // The booking page is the referral landing without the invite, so its pairs are
  // made against that design's boards instead (npm run fidelity:refer).

  await design.close();
  await site.close();
}

const servers: Server[] = [await serveDirectory(SITE_DIR, 4311), await serveDirectory(DESIGN_DIR, 4312)];
const browser = await chromium.launch();
try {
  for (const width of WIDTHS) {
    console.log(`fidelity: ${String(width)} px`);
    await run(browser, width);
  }
  console.log(`fidelity: written to ${OUT}`);
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
