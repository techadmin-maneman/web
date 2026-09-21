// Browser tests of the built site (e2e/), at the design's two widths. They run
// against the local build: npm run build:site -- --env local && npm run test:e2e.
// F2 and F3 add runs against staging with the backend's stubs.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: "http://127.0.0.1:4321", trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/serve-site.ts --env local --port 4321",
    url: "http://127.0.0.1:4321/",
    reuseExistingServer: process.env.CI === undefined,
  },
  projects: [
    { name: "390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
