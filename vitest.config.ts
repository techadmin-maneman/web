import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { StalledFiles } from "./test/stalled-files.ts";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    restoreMocks: true,
    // Vitest's own, and a watchdog that ends a run whose files have stopped reporting (test/stalled-files.ts).
    reporters: ["default", ...(process.env.GITHUB_ACTIONS === "true" ? ["github-actions"] : []), new StalledFiles()],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 85 },
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
                FSM_QUEUE: { queueName: "mm-fsm-sync-unconsumed" },
              },
              // The local secrets the Worker needs to start; the same values as .dev.vars.example.
              bindings: {
                TEST_MIGRATIONS: migrations,
                TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
                IP_HASH_SALT: "local-development-salt-not-a-real-secret",
                RESULT_SIGNING_KEY: "local-link-signing-key-not-a-real-secret",
                ERASURE_SECRET: "local-erasure-secret-not-a-real-secret",
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
           * nothing about the code.
           */
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/node/**/*.test.ts"],
        },
      },
    ],
  },
});
