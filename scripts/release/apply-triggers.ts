// Attaches every Worker's triggers in one environment, from its config: routes,
// cron schedules and queue consumers. CI cannot (docs/decisions/0010-applying-triggers.md),
// so an operator runs this with their own wrangler login, once the code that
// handles them is live.
//
//   npm run apply-triggers -- --env staging
//
// An app whose surface is not switched on there is passed over, deployed or
// not: its bootstrap or its surface's release attaches its route (docs/runbook.md,
// step 11). Given a
// CLOUDFLARE_API_TOKEN that can read Workers and Queues, it then checks that
// what is live matches (scripts/release/check-triggers.ts).

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { currentVersion, wranglerFor } from "../lib/release.ts";
import { WORKERS } from "../lib/workers.ts";

const { values } = parseArgs({ options: { env: { type: "string" } } });
const environment = values.env;
if (environment !== "staging" && environment !== "production") {
  console.error("usage: npm run apply-triggers -- --env <staging|production>");
  process.exit(2);
}

for (const worker of WORKERS) {
  const wrangler = wranglerFor(worker, environment);
  if (currentVersion({ worker, environment, wrangler }) === "") {
    console.log(`${worker.name}-${environment}: not deployed yet, so nothing to attach`);
    continue;
  }
  console.log(`${worker.name}-${environment}: attaching its triggers`);
  console.log(wrangler(["triggers", "deploy"]));
}

if ((process.env.CLOUDFLARE_API_TOKEN ?? "") === "") {
  console.log(
    `To confirm what is live: node --env-file=<file> scripts/release/check-triggers.ts ${environment} --strict`,
  );
} else {
  execFileSync(process.execPath, ["scripts/release/check-triggers.ts", environment, "--strict"], { stdio: "inherit" });
}
