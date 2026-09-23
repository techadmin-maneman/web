// The technician app against the deployed mm-api, over real HTTPS, through real
// Cloudflare Access. Nothing here is faked: no page.route(), no stubbed fetch,
// no local Worker.
//
// It is a config of its own, and not a project in playwright.config.ts, because
// `npm run test:e2e` is what CI runs: CI holds no Access credentials, and a
// pull request must not fail because staging is down. This is run by hand:
//
//   npm run test:tech-staging
//
// The Access service token comes from `.env.staging-access` (docs/runbook.md,
// step 3), or from the environment when that file is not beside the checkout,
// as it is not in a worktree. The credentials are read, never printed.

import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const ACCESS_ENV_FILE = ".env.staging-access";
if (process.env.CF_ACCESS_CLIENT_ID === undefined && existsSync(ACCESS_ENV_FILE)) {
  process.loadEnvFile(ACCESS_ENV_FILE);
}

const clientId = process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (clientId === undefined || clientSecret === undefined) {
  throw new Error(
    `no Access service token: put CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in ${ACCESS_ENV_FILE} or in the environment`,
  );
}

export default defineConfig({
  testDir: "e2e/tech-staging",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/tech-staging/global-setup.ts",
  globalTeardown: "./e2e/tech-staging/global-teardown.ts",
  // One job, one phone, one day: the checks run in the order a technician works in.
  fullyParallel: false,
  workers: 1,
  // A retry would replay a step the API has already landed, and prove nothing.
  retries: 0,
  reporter: "list",
  // Staging answers from Singapore, and a photograph upload is five round trips.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "https://tech-staging.maneman.in",
    extraHTTPHeaders: { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret },
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    // The deployed app registers one, and this proof is partly about it.
    serviceWorkers: "allow",
    reducedMotion: "reduce",
    permissions: ["camera", "geolocation"],
    // Board B1's capture: Chromium's green test pattern instead of a camera, so no
    // photograph of anyone is ever taken or uploaded.
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  projects: [{ name: "tech-staging" }],
});
