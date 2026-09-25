// Compares the cron schedules and queue consumers Cloudflare has attached with
// what every Worker's config asks for, in one environment. Read-only. The deploy
// workflows run it after deploying; an operator runs it after applying triggers.
// See docs/decisions/0010-applying-triggers.md and scripts/lib/triggers.ts.
//
//   node scripts/check-triggers.ts staging                        (CI: CLOUDFLARE_API_TOKEN is set)
//   node --env-file=<file> scripts/check-triggers.ts production   (a token that can read Workers and Queues)
//   … --strict                                                    exits 1 when anything differs
//
// Without --strict it exits 0 whatever it finds: CI cannot apply triggers, so a
// difference is a warning for the operator, not a failed deploy.

import { parseArgs } from "node:util";
import { accountIdFor } from "./lib/cloudflare-api.ts";
import { printFindings } from "./lib/findings.ts";
import { readJsonc } from "./lib/jsonc.ts";
import { checkTriggers } from "./lib/triggers.ts";
import { WORKERS } from "./lib/workers.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { strict: { type: "boolean", default: false } },
});
const environment = positionals[0];
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
if ((environment !== "staging" && environment !== "production") || token === "") {
  console.error("usage: CLOUDFLARE_API_TOKEN=… node scripts/check-triggers.ts <staging|production> [--strict]");
  process.exit(2);
}

const findings = await checkTriggers({
  environment,
  accountId: accountIdFor(environment),
  token,
  workers: WORKERS.map((worker) => ({ name: worker.name, config: readJsonc(worker.config) })),
});
printFindings(findings);

const differing = findings.filter((finding) => finding.outcome === "differs").length;
if (values.strict && differing > 0) process.exit(1);
