// Lighthouse on the built site and the client app, with the front-end
// prompts' budgets. It starts the local mm-api (stub providers) and serves the
// local builds the way the browser tests do, then audits each page on
// Lighthouse's mobile profile: the site's home, try-on and booking pages, an
// invite's landing, and the client app's first screen.
//
//   npm run build:site -- --env local && npm run build:app -- --env local && node scripts/lighthouse.ts
//
// Reports go to lighthouse/ (git-ignored). Every score and metric is printed;
// the run fails on any the page's budget names.
//
// Lighthouse measures a page load, so it cannot measure INP, which needs real
// interactions; Total Blocking Time is its stand-in, held to the same 200 ms.
// The local build is noindex, like staging, so the "page is crawlable" audit
// is skipped; production's pages are indexable.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { serveDirectory } from "./lib/static-server.ts";

const SITE_PORT = 4331;
const APP_PORT = 4332;
const API_PORT = 8797;
const DEBUG_PORT = 9333;

const SITE = `http://127.0.0.1:${String(SITE_PORT)}`;
// As the browser tests reach it: mm-api chooses the client surface by this host (docs/decisions/0026).
const APP = `http://app.localhost:${String(APP_PORT)}`;

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
const METRICS = ["largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time"] as const;

interface Budget {
  readonly scores: Partial<Record<(typeof CATEGORIES)[number], number>>;
  readonly metrics: Partial<Record<(typeof METRICS)[number], number>>;
}

/** The public site's (docs/prompts/phase1-frontend.md), which the referral landing meets too (phase2-frontend.md). */
const SITE_BUDGET: Budget = {
  scores: { performance: 0.9, accessibility: 0.95, "best-practices": 0.95, seo: 0.95 },
  metrics: { "largest-contentful-paint": 2500, "cumulative-layout-shift": 0.1, "total-blocking-time": 200 },
};

/**
 * The client app's (docs/prompts/phase2-frontend.md): LCP under 2.5 s, and
 * WCAG 2.2 AA, for which Lighthouse's accessibility audits are the floor. Its
 * 150 KB of JavaScript is checked by its build (scripts/lib/spa-build.ts).
 */
const APP_BUDGET: Budget = {
  scores: { accessibility: 0.95, "best-practices": 0.95 },
  metrics: { "largest-contentful-paint": 2500 },
};

/** Each page audited: its report's name, its address, and its budget. */
const PAGES: readonly { name: string; url: string; budget: Budget }[] = [
  { name: "home", url: `${SITE}/`, budget: SITE_BUDGET },
  { name: "try", url: `${SITE}/try`, budget: SITE_BUDGET },
  { name: "book", url: `${SITE}/book`, budget: SITE_BUDGET },
  // Every invite is the same page (docs/decisions/0027-referral-landing.md); the local API does not know this
  // code, so the page shows its unknown-invite state.
  { name: "invite", url: `${SITE}/r/PREVIEW1`, budget: SITE_BUDGET },
  { name: "app", url: `${APP}/`, budget: APP_BUDGET },
];

const answers = (url: string) =>
  fetch(url).then(
    (response) => response,
    () => null,
  );

/** Waits for the local mm-api, and makes sure it is the local one and not another server on the port. */
async function waitForLocalApi(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await answers(url);
    if (response !== null) {
      const health = (await response.json().catch(() => null)) as { environment?: string } | null;
      if (health?.environment === "local") return;
      throw new Error(`${url} is not the local mm-api: is another server using the port?`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not answer`);
}

/** Stops wrangler and the workerd it started, which a plain kill leaves running on Windows. */
function stop(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else process.kill(-child.pid);
}

for (const port of [SITE_PORT, APP_PORT, API_PORT]) {
  if ((await answers(`http://127.0.0.1:${String(port)}/`)) !== null) throw new Error(`port ${String(port)} is in use`);
}

const api = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--port",
    String(API_PORT),
    "--inspector-port",
    String(API_PORT + 1),
  ],
  // Its own process group, so stop() can end workerd with it.
  { stdio: "ignore", detached: process.platform !== "win32" },
);
const site = await serveDirectory("site/dist/local", SITE_PORT, `http://127.0.0.1:${String(API_PORT)}`);
const app = await serveDirectory("apps/app/dist/local", APP_PORT, `http://127.0.0.1:${String(API_PORT)}`, {
  spa: true,
  keepHost: true,
});
const browser = await chromium.launch({ args: [`--remote-debugging-port=${String(DEBUG_PORT)}`] });

const failures: string[] = [];
try {
  await waitForLocalApi(`http://127.0.0.1:${String(API_PORT)}/api/health`);
  mkdirSync("lighthouse", { recursive: true });
  for (const page of PAGES) {
    const result = await lighthouse(page.url, {
      port: DEBUG_PORT,
      output: "html",
      logLevel: "error",
      onlyCategories: [...CATEGORIES],
      skipAudits: ["is-crawlable"],
    });
    if (result === undefined) throw new Error(`Lighthouse returned nothing for ${page.url}`);
    const { lhr, report } = result;
    writeFileSync(`lighthouse/${page.name}.html`, Array.isArray(report) ? report.join("") : report);

    const line: string[] = [];
    for (const category of CATEGORIES) {
      const score = lhr.categories[category]?.score ?? 0;
      const minimum = page.budget.scores[category];
      line.push(`${category} ${String(Math.round(score * 100))}`);
      if (minimum !== undefined && score < minimum) {
        failures.push(`${page.name}: ${category} ${String(score)} < ${String(minimum)}`);
      }
    }
    for (const audit of METRICS) {
      const value = lhr.audits[audit]?.numericValue ?? Infinity;
      const maximum = page.budget.metrics[audit];
      line.push(`${audit} ${value.toFixed(audit === "cumulative-layout-shift" ? 3 : 0)}`);
      if (maximum !== undefined && value >= maximum) {
        failures.push(`${page.name}: ${audit} ${String(value)} ≥ ${String(maximum)}`);
      }
    }
    console.log(`${page.name.padEnd(7)} ${line.join(" · ")}`);
  }
} finally {
  await browser.close();
  site.close();
  app.close();
  stop(api);
}

if (failures.length > 0) {
  console.error(`\nOver budget:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log("\nEvery page is within budget. Reports: lighthouse/");
