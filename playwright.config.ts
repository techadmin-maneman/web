// Browser tests of the built site (e2e/), at the design's two widths, and of
// the client app (e2e/app/) at its one. Each is served with /api/* passed to a
// local mm-api, which runs the backend with its stub providers on a local D1.
// The app is on app.localhost, so mm-api answers it as the client surface.
//
//   node scripts/ensure-dev-vars.ts && npm run db:local
//   npm run build:site -- --env local && npm run build:app -- --env local && npm run test:e2e

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
      // The tests book leads and render try-ons from one address, run after run on one local
      // database, so the limits per address and the daily ceilings are raised for them.
      command: [
        "node node_modules/wrangler/bin/wrangler.js dev --port 8787 --inspector-port 9230",
        "--var LEAD_IP_DAILY_LIMIT:10000",
        "--var TRYON_UPLOAD_IP_HOURLY_LIMIT:10000",
        "--var TRYON_GENERATE_IP_HOURLY_LIMIT:10000",
        "--var UPLOAD_DAILY_CEILING:10000",
        "--var RENDER_DAILY_CEILING:10000",
        "--var RESULT_READ_DAILY_CEILING:10000",
        // The client app's login: every code is this one locally (docs/decisions/0030), and the limits are raised.
        "--var OTP_FIXED_CODE:246810",
        "--var OTP_IP_HOURLY_LIMIT:10000",
        "--var OTP_DAILY_CEILING:10000",
      ].join(" "),
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: local,
      timeout: 120_000,
    },
    {
      command: "node scripts/serve-site.ts --env local --port 4321 --api http://127.0.0.1:8787",
      url: "http://127.0.0.1:4321/",
      reuseExistingServer: local,
    },
    {
      command: "node scripts/serve-app.ts --env local --port 4322 --api http://127.0.0.1:8787",
      url: "http://127.0.0.1:4322/",
      reuseExistingServer: local,
    },
  ],
  projects: [
    {
      name: "390",
      testIgnore: "app/**",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "1440",
      testIgnore: "app/**",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "app",
      testMatch: "app/**/*.e2e.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        baseURL: "http://app.localhost:4322",
        // A service worker would answer requests that page.route() means to fake. The offline
        // tests (e2e/app/pwa.e2e.ts) allow it.
        serviceWorkers: "block",
      },
    },
  ],
});
