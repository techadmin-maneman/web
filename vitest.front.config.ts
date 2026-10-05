// The front ends' coverage, a report of its own beside mm-api's (vitest.config.ts): the node tests of the apps' logic
// and the DOM tests of their components and hooks, measured over the apps, the shared packages and the site. Its floor
// sits just under what the suite reaches, so a fall shows (npm run test:coverage:front).

import { defineConfig } from "vitest/config";
import { DOM_PROJECT, NODE_PROJECT } from "./vitest.config.ts";

export default defineConfig({
  test: {
    restoreMocks: true,
    projects: [NODE_PROJECT, DOM_PROJECT],
    coverage: {
      provider: "istanbul",
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/api-schema.ts", "**/node_modules/**", "**/dist/**"],
      reportsDirectory: "coverage-front",
      reporter: ["text-summary", "json-summary"],
      // Just under the 32% of lines and 23% of branches the suite reached when the report began: a fall shows, and the
      // floor rises as screens' logic moves into node-tested modules (P3-30).
      thresholds: { lines: 31, branches: 22 },
    },
  },
});
