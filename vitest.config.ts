import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { StalledFiles } from "./test/stalled-files.ts";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    restoreMocks: true,
    /*
     * Two runners share the owner's twelve-core machine (docs/runbook.md, "The CI runner"), and vitest's default
     * takes a worker a core: two jobs of tests, or tests beside the browser tests, then took every core and more,
     * and hooks and wrangler's dev proxy timed out for want of a CPU, not a defect. Playwright is held to three
     * workers for the same reason (playwright.config.ts).
     */
    maxWorkers: process.env.CI === undefined ? undefined : 4,
    // Vitest's own, and a watchdog that ends a run whose files have stopped reporting (test/stalled-files.ts).
    reporters: ["default", ...(process.env.GITHUB_ACTIONS === "true" ? ["github-actions"] : []), new StalledFiles()],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts", "scripts/lib/**/*.ts"],
      // "src/**" also matches the apps' and the site's own src/ folders, which the report then counted as mm-api's.
      exclude: ["src/**/*.d.ts", "apps/**", "site/**", "packages/**"],
      reporter: ["text", "json-summary"],
      /*
       * Branches as well as lines: the integrations were where branches went untested behind a line figure
       * that looked well (TCD-03). The files that speak to a vendor, or keep what it says was paid, have floors
       * of their own, so a weak one cannot hide in the whole; each was below 70% on branches before its
       * recorded-reply tests.
       */
      thresholds: {
        // Just under what the suite reaches, so a fall shows.
        lines: 97,
        branches: 87,
        "src/providers/**": { lines: 90, branches: 85 },
        "src/providers/razorpay.ts": { lines: 95, branches: 95 },
        "src/domain/payments.ts": { lines: 90, branches: 90 },
        // Where money is taken, held, owed back or given as credit: a branch untested there is money lost unseen.
        "src/domain/{payment-links,discount-code-holds,discount-code-uses,holds,bookings,credits,refunds,no-shows}.ts":
          { lines: 90, branches: 90 },
        // Its one branch untaken is a hold with no client, which every hold has.
        "src/http/book-hold.ts": { lines: 90, branches: 85 },
        "src/routes/razorpay-hook.ts": { lines: 90, branches: 90 },
        // What the deploy and check scripts share. A release's recovery from a lost reply first runs in an incident.
        "scripts/lib/**": { lines: 85, branches: 70 },
        "scripts/lib/release.ts": { lines: 95, branches: 90 },
      },
    },
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              /*
               * Each queue a route sends to here is one nobody consumes. wrangler.jsonc's consumers would
               * otherwise run the real queue() handler seconds after a test's request, often once its file
               * had ended, and its logs, sent from outside the file's context, broke the pool's channel:
               * the file never reported finished and the run waited for it forever. Tests that need a
               * message pass a fakeQueue() or call the handler (test/worker/helpers.ts).
               */
              queueProducers: {
                RENDER_QUEUE: { queueName: "mm-render-unconsumed" },
                CRM_QUEUE: { queueName: "mm-crm-sync-unconsumed" },
                MESSAGE_QUEUE: { queueName: "mm-messaging-unconsumed" },
              },
              // The local secrets the Worker needs to start; the same values as .dev.vars.example.
              bindings: {
                TEST_MIGRATIONS: migrations,
                TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
                IP_HASH_SALT: "local-development-salt-not-a-real-secret",
                RESULT_SIGNING_KEY: "local-link-signing-key-not-a-real-secret",
                OTP_PEPPER: "local-login-code-pepper-not-a-real-secret",
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          setupFiles: ["./test/worker/setup.ts"],
          /*
           * These tests run inside workerd and write to a real D1, so a slow one is
           * doing work, not hanging. Vitest's five seconds is enough on an idle
           * machine and not on a busy one, which failed CI repeatedly while proving
           * nothing about the code. Their setup gets the same: with both of the
           * owner's runners on tests at once, a file's first hook, which applies the
           * migrations, outran vitest's ten seconds on every run.
           */
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/node/**/*.test.ts"],
        },
      },
      {
        // The apps' components, mounted on a page. Their React is the client app's: from packages/ui, React
        // would otherwise resolve to the repository root's React 18, as apps/app/vite.config.ts says.
        resolve: {
          alias: {
            react: `${import.meta.dirname}/apps/app/node_modules/react`,
            "react-dom": `${import.meta.dirname}/apps/app/node_modules/react-dom`,
          },
        },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["test/dom/**/*.test.ts"],
        },
      },
    ],
  },
});
