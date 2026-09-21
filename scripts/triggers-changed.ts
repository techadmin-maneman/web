// Warns when a merge changed an environment's triggers (routes, cron
// schedules or queue consumers). CI cannot apply them; an operator runs
// `npm run apply-triggers -- --env <env>` once the code is deployed.
// See docs/decisions/0010-applying-triggers.md.
//
//   node scripts/triggers-changed.ts --base <git-ref> --env staging

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parse } from "jsonc-parser";

const { values } = parseArgs({ options: { base: { type: "string" }, env: { type: "string" } } });
const environment = values.env;
if (values.base === undefined || (environment !== "staging" && environment !== "production")) {
  console.error("usage: node scripts/triggers-changed.ts --base <git-ref> --env <staging|production>");
  process.exit(2);
}

/** The parts of one environment's config that `wrangler triggers deploy` applies. */
function triggersOf(configText: string): string {
  const config = parse(configText) as { env?: Record<string, Record<string, unknown> | undefined> };
  const block = config.env?.[environment ?? ""] ?? {};
  const queues = block.queues as { consumers?: unknown } | undefined;
  return JSON.stringify({ routes: block.routes, triggers: block.triggers, consumers: queues?.consumers });
}

let before: string;
try {
  before = execFileSync("git", ["show", `${values.base}:wrangler.jsonc`], { encoding: "utf8" });
} catch {
  process.exit(0); // no config at the base: nothing to compare
}

if (triggersOf(before) !== triggersOf(readFileSync("wrangler.jsonc", "utf8"))) {
  console.log(
    `::warning::The ${environment} triggers changed in this merge. Once it is deployed, an operator must run: ` +
      `npm run apply-triggers -- --env ${environment} (docs/decisions/0010-applying-triggers.md)`,
  );
}
