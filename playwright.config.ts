// Browser tests of the built site (e2e/), at the design's two widths. The site
// is served with /api/* passed to a local mm-api, which runs the backend with
// its stub providers on a local D1:
//
//   node scripts/ensure-dev-vars.ts && npm run db:local
//   npm run build:site -- --env local && npm run test:e2e

import { defineConfig, devices } from "@playwright/test";

const local = process.env.CI === undefined;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !local,
  retries: local ? 0 : 1,
  reporter: local ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://127.0.0.1:4321", trace: "retain-on-failure" },
  webServer: [
    {
      // The tests book many leads from one address; the daily limit per address is raised for them.
      command:
        "node node_modules/wrangler/bin/wrangler.js dev --port 8787 --inspector-port 9230 --var LEAD_IP_DAILY_LIMIT:10000",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: local,
      timeout: 120_000,
    },
    {
      command: "node scripts/serve-site.ts --env local --port 4321 --api http://127.0.0.1:8787",
      url: "http://127.0.0.1:4321/",
      reuseExistingServer: local,
    },
  ],
  projects: [
    { name: "390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
