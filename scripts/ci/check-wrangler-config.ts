// Fails when an environment does not redeclare every binding, names another
// environment's resources, inherits a route, or exposes workers.dev.
//
//   node scripts/ci/check-wrangler-config.ts                         check the real configs
//   node scripts/ci/check-wrangler-config.ts --require-provisioned   also reject placeholder IDs (deploy)
//   node scripts/ci/check-wrangler-config.ts --api <file> --expect-problem "<text>"
//       negative test: succeeds only if <file> fails with a problem containing <text>

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readJsonc } from "../lib/jsonc.ts";
import {
  checkAccountsAgree,
  checkApiConfig,
  checkSiteConfig,
  checkSpaConfig,
  secretNamesIn,
} from "../lib/wrangler-config-check.ts";
import { STATIC_WORKERS } from "../lib/workers.ts";

const { values } = parseArgs({
  options: {
    api: { type: "string", default: "wrangler.jsonc" },
    site: { type: "string", default: "site/wrangler.jsonc" },
    "require-provisioned": { type: "boolean", default: false },
    "expect-problem": { type: "string" },
  },
});

const api = readJsonc(values.api);
const site = readJsonc(values.site);
const secretNames = secretNamesIn(readFileSync(".dev.vars.example", "utf8"));
const problems = [
  ...checkApiConfig(api, { requireProvisioned: values["require-provisioned"], secretNames }),
  ...checkSiteConfig(site),
  ...checkAccountsAgree(api, site),
  // Each single-page app in the registry, against its own surface.
  ...STATIC_WORKERS.filter((worker) => worker.kind === "spa").flatMap((worker) => {
    if (worker.surface === undefined) return [`${worker.name}: a single-page app must name its surface`];
    const config = readJsonc(worker.config);
    return [
      ...checkSpaConfig(config, { name: worker.name, surface: worker.surface }),
      ...checkAccountsAgree(api, config, worker.name),
    ];
  }),
];

const expected = values["expect-problem"];
if (expected !== undefined) {
  const matched = problems.some((problem) => problem.includes(expected));
  console.log(problems.map((p) => `  - ${p}`).join("\n"));
  if (!matched) {
    console.error(`FAIL: ${values.api} was expected to fail with a problem containing "${expected}"`);
    process.exit(1);
  }
  console.log(`OK: ${values.api} is rejected as expected ("${expected}")`);
  process.exit(0);
}

if (problems.length > 0) {
  console.error(`wrangler config check failed (${String(problems.length)} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `wrangler config check passed: ${[values.api, values.site, ...STATIC_WORKERS.filter((w) => w.kind === "spa").map((w) => w.config)].join(", ")}`,
);
