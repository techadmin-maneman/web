// Lighthouse on the built site, with the front-end prompt's budgets. It starts
// the local mm-api (stub providers) and serves the local build the way the
// browser tests do, then audits each page on Lighthouse's mobile profile.
//
//   npm run build:site -- --env local && node scripts/lighthouse.ts
//
// Reports go to lighthouse/ (git-ignored). The run fails on any missed budget.
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

const PAGES = ["/", "/try", "/book"];
const SITE_PORT = 4331;
const API_PORT = 8797;
const DEBUG_PORT = 9333;

const MIN_SCORE = { performance: 0.9, accessibility: 0.95, "best-practices": 0.95, seo: 0.95 } as const;
const MAX_METRIC = {
  "largest-contentful-paint": 2500,
  "cumulative-layout-shift": 0.1,
  "total-blocking-time": 200,
} as const;

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

for (const port of [SITE_PORT, API_PORT]) {
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
const browser = await chromium.launch({ args: [`--remote-debugging-port=${String(DEBUG_PORT)}`] });

const failures: string[] = [];
try {
  await waitForLocalApi(`http://127.0.0.1:${String(API_PORT)}/api/health`);
  mkdirSync("lighthouse", { recursive: true });
  for (const page of PAGES) {
    const result = await lighthouse(`http://127.0.0.1:${String(SITE_PORT)}${page}`, {
      port: DEBUG_PORT,
      output: "html",
      logLevel: "error",
      onlyCategories: Object.keys(MIN_SCORE),
      skipAudits: ["is-crawlable"],
    });
    if (result === undefined) throw new Error(`Lighthouse returned nothing for ${page}`);
    const { lhr, report } = result;
    const name = page === "/" ? "home" : page.slice(1);
    writeFileSync(`lighthouse/${name}.html`, Array.isArray(report) ? report.join("") : report);

    const line: string[] = [];
    for (const [category, minimum] of Object.entries(MIN_SCORE)) {
      const score = lhr.categories[category]?.score ?? 0;
      line.push(`${category} ${String(Math.round(score * 100))}`);
      if (score < minimum) failures.push(`${page}: ${category} ${String(score)} < ${String(minimum)}`);
    }
    for (const [audit, maximum] of Object.entries(MAX_METRIC)) {
      const value = lhr.audits[audit]?.numericValue ?? Infinity;
      line.push(`${audit} ${value.toFixed(audit === "cumulative-layout-shift" ? 3 : 0)}`);
      if (value >= maximum) failures.push(`${page}: ${audit} ${String(value)} ≥ ${String(maximum)}`);
    }
    console.log(`${page.padEnd(6)} ${line.join(" · ")}`);
  }
} finally {
  await browser.close();
  site.close();
  stop(api);
}

if (failures.length > 0) {
  console.error(`\nOver budget:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log("\nEvery page is within budget. Reports: lighthouse/");
