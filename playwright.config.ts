// Browser tests of the built site (e2e/), at the design's two widths, of the
// client app (e2e/app/) at its one, of the ops console (e2e/ops/) at 1440, and
// of the technician app (e2e/tech/) at the phone width its boards are drawn at.
// Each is served with /api/* passed to a local mm-api, which runs the backend
// with its stub providers on a local D1. The app is on app.localhost, the
// console on ops.localhost and the technician app on tech.localhost, so mm-api
// answers each as its own surface.
//
//   node scripts/dev/ensure-dev-vars.ts && npm run db:local
//   npm run build:site -- --env local && npm run build:app -- --env local
//   npm run build:ops -- --env local && npm run build:tech -- --env local
//   npm run test:e2e
//
// The ports are scripts/lib/local-stack.ts's, which npm run dev:all shares; one
// another program holds can be moved, e.g. MM_API_PORT=8797 npm run test:e2e.

import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, apiDevArgs, PORTS } from "./scripts/lib/local-stack.ts";

const local = process.env.CI === undefined;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !local,
  retries: local ? 0 : 1,
  /*
   * In CI: three workers, a step waits up to fifteen seconds and a test a minute. The runner is also busy with the
   * local mm-api and four servers, so a page can answer late; a test should fail for a defect, not for want of a CPU.
   */
  workers: local ? undefined : 3,
  timeout: local ? 30_000 : 60_000,
  expect: { timeout: local ? 5_000 : 15_000 },
  reporter: local ? "list" : [["list"], ["github"]],
  use: { baseURL: `http://127.0.0.1:${String(PORTS.site)}`, trace: "retain-on-failure" },
  webServer: [
    {
      // mm-api with the local login code, and the limits raised: the tests book, render and log in
      // run after run from one address on one local database (scripts/lib/local-stack.ts).
      command: ["node", ...apiDevArgs()].join(" "),
      url: `${API_ORIGIN}/api/health`,
      reuseExistingServer: local,
      timeout: 120_000,
    },
    {
      command: `node scripts/dev/serve-site.ts --env local --port ${String(PORTS.site)} --api ${API_ORIGIN}`,
      url: `http://127.0.0.1:${String(PORTS.site)}/`,
      reuseExistingServer: local,
    },
    {
      command: `node scripts/dev/serve-app.ts --env local --port ${String(PORTS.app)} --api ${API_ORIGIN}`,
      url: `http://127.0.0.1:${String(PORTS.app)}/`,
      reuseExistingServer: local,
    },
    {
      command: `node scripts/dev/serve-ops.ts --env local --port ${String(PORTS.ops)} --api ${API_ORIGIN}`,
      url: `http://127.0.0.1:${String(PORTS.ops)}/`,
      reuseExistingServer: local,
    },
    {
      command: `node scripts/dev/serve-tech.ts --env local --port ${String(PORTS.tech)} --api ${API_ORIGIN}`,
      url: `http://127.0.0.1:${String(PORTS.tech)}/`,
      reuseExistingServer: local,
    },
  ],
  projects: [
    {
      name: "390",
      // tech-staging/ is the proof against the deployed API, which has its own
      // config and is never run by CI (playwright.staging.config.ts).
      testIgnore: ["app/**", "ops/**", "tech/**", "tech-live/**", "tech-staging/**"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "1440",
      testIgnore: ["app/**", "ops/**", "tech/**", "tech-live/**", "tech-staging/**"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "app",
      testMatch: "app/**/*.e2e.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        baseURL: `http://app.localhost:${String(PORTS.app)}`,
        // A service worker would answer requests that page.route() means to fake. The offline
        // tests (e2e/app/pwa.e2e.ts) allow it.
        serviceWorkers: "block",
        // The app's fades and sheets stand still, so axe never reads a page halfway in.
        reducedMotion: "reduce",
      },
    },
    {
      // The ops console is a desk tool, drawn at 1440 (docs/fidelity-method.md).
      name: "ops",
      testMatch: "ops/**/*.e2e.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://ops.localhost:${String(PORTS.ops)}`,
        // The console registers none, and a stale one would answer what page.route() means to fake.
        serviceWorkers: "block",
        reducedMotion: "reduce",
      },
    },
    {
      // The technician app, at the width its boards are drawn at (design/phase2/Technician App.dc.html).
      name: "tech",
      testMatch: "tech/**/*.e2e.ts",
      // ios.e2e.ts is the same app on WebKit and has its own project below.
      testIgnore: "tech/ios.e2e.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        baseURL: `http://tech.localhost:${String(PORTS.tech)}`,
        // The app registers none, and a stale one would answer what page.route() means to fake.
        serviceWorkers: "block",
        // Board B1's capture: a green test pattern instead of a camera, granted without a prompt.
        permissions: ["camera"],
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
        // The steps stand still, so axe never reads a screen halfway in.
        reducedMotion: "reduce",
      },
    },
    {
      // The technician app against the local mm-api, with nothing faked: one technician's day, worked through
      // (e2e/tech-live/day.e2e.ts, ADR 0075). Its two tests share a technician, so they run in order.
      name: "tech-live",
      testMatch: "tech-live/**/*.e2e.ts",
      fullyParallel: false,
      // A retry would replay steps the API has already landed, and prove nothing.
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        baseURL: `http://tech.localhost:${String(PORTS.tech)}`,
        serviceWorkers: "block",
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
        reducedMotion: "reduce",
      },
    },
    {
      /*
       * The technician app on WebKit, since the owner ruled that technicians
       * use any phone, including iPhones (docs/open-points.md, item 124). It is
       * the engine an iPhone runs and it is **not** Safari on iOS: it has none
       * of Safari's storage policy, its seven-day cap or its Home Screen Web
       * Apps, so it proves the app's code paths run there and nothing about
       * what an iPhone keeps. Only e2e/tech/ios.e2e.ts runs here — a second
       * engine over every screen would double the run for little, and the
       * camera's fake device is Chromium's alone.
       *
       * It runs in CI with the rest: `npm run test:e2e` names it, and the
       * browser job installs webkit beside chromium. Run it alone with
       * `npm run test:tech-ios`, after `npx playwright install webkit`.
       */
      name: "tech-ios",
      testMatch: "tech/ios.e2e.ts",
      use: {
        ...devices["iPhone 15"],
        baseURL: `http://tech.localhost:${String(PORTS.tech)}`,
        // A stale worker would answer what page.route() means to fake, as in "tech".
        serviceWorkers: "block",
        reducedMotion: "reduce",
      },
    },
  ],
});
