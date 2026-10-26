// The six-month timelapse (e2e/timelapse/), against the stack scripts/dev/timelapse.ts starts. One test plays every
// day in order, so it runs alone; a failure inside it is written down and the days go on (e2e/timelapse/steps.ts).

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/timelapse",
  testMatch: "timelapse.e2e.ts",
  // Its own folder: Playwright empties its output folder as it starts, and the run writes beside it.
  outputDir: "test-results/timelapse/playwright",
  workers: 1,
  retries: 0,
  timeout: 60 * 60_000,
  expect: { timeout: 6_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    trace: "off",
    video: "off",
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
});
