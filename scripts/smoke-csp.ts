// npm run smoke:csp -- --environment staging
//
// Opens every switched-on host's pages in headless Chromium, as deployed, and fails on anything a page's content
// security policy refuses, or a page that does not load (scripts/lib/smoke-csp.ts). Runs after every staging deploy.
//
// Environment:
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET   Access service token, sent to our own hosts only. By hand, it is
//                                                   read from .env.staging-access when the environment has none.

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "@playwright/test";
import type { RemoteEnvironmentName } from "../src/config/environments.ts";
import { recordPolicyRefusals } from "./lib/csp-refusals.ts";
import { isOwnHost, pagesToCheck } from "./lib/smoke-csp.ts";

/** Long enough for the scripts a page adds after it loads, and for an app's first screen to draw. */
const SETTLE_MS = 2_000;
const ACCESS_ENV_FILE = ".env.staging-access";

const { values } = parseArgs({ options: { environment: { type: "string" } } });
const environment = values.environment;
if (environment !== "staging" && environment !== "production") {
  console.error("usage: smoke-csp --environment <staging|production>");
  process.exit(2);
}

function accessHeaders(): Record<string, string> {
  if (process.env.CF_ACCESS_CLIENT_ID === undefined && existsSync(ACCESS_ENV_FILE)) {
    process.loadEnvFile(ACCESS_ENV_FILE);
  }
  const id = process.env.CF_ACCESS_CLIENT_ID ?? "";
  const secret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
  if (id === "" || secret === "") return {};
  return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
}

/** What went wrong on one page: each refusal of its policy, or why it did not load. */
async function problemsOn(
  browser: Browser,
  url: string,
  environment: RemoteEnvironmentName,
  access: Record<string, string>,
): Promise<string[]> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!isOwnHost(request.url(), environment)) return route.continue();
      return route.continue({ headers: { ...(await request.allHeaders()), ...access } });
    });
    const page = await context.newPage();
    const refused = await recordPolicyRefusals(page);
    const response = await page.goto(url, { waitUntil: "load" });
    if (response?.ok() !== true) return [`answered ${String(response?.status() ?? "nothing")}`];
    if (!isOwnHost(page.url(), environment)) return [`ended on ${page.url()}, not the page: is Access letting it in?`];
    await page.waitForTimeout(SETTLE_MS);
    return refused;
  } finally {
    await context.close();
  }
}

const access = accessHeaders();
const browser = await chromium.launch();
let failed = 0;
try {
  for (const url of pagesToCheck(environment)) {
    const problems = await problemsOn(browser, url, environment, access);
    console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${url}`);
    for (const problem of problems) console.log(`      ${problem}`);
    if (problems.length > 0) failed += 1;
  }
} finally {
  await browser.close();
}

if (failed > 0) {
  console.error(`content security policy check failed on ${String(failed)} page(s) (${environment})`);
  process.exit(1);
}
console.log(`content security policy check passed: no page refused anything (${environment})`);
