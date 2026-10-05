// Checks that every R2 bucket an environment's Workers bind exists, that the
// try-on buckets expire every object within 30 days, and that no other bucket
// expires anything. Read-only. See scripts/lib/buckets.ts.
//
//   node --env-file=<file> scripts/release/check-buckets.ts production   (a token that can read R2)
//   node scripts/release/check-buckets.ts staging                        (CI: says it may not read R2, by design)
//   … --strict                                                   exits 1 when anything differs

import { parseArgs } from "node:util";
import { checkBuckets } from "../lib/buckets.ts";
import { accountIdFor } from "../lib/cloudflare-api.ts";
import { printFindings } from "../lib/findings.ts";
import { readJsonc } from "../lib/jsonc.ts";
import { WORKERS } from "../lib/workers.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { strict: { type: "boolean", default: false } },
});
const environment = positionals[0];
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
if ((environment !== "staging" && environment !== "production") || token === "") {
  console.error("usage: CLOUDFLARE_API_TOKEN=… node scripts/release/check-buckets.ts <staging|production> [--strict]");
  process.exit(2);
}

const findings = await checkBuckets({
  environment,
  accountId: accountIdFor(environment),
  token,
  configs: WORKERS.map((worker) => readJsonc(worker.config)),
});
printFindings(findings);

const differing = findings.filter((finding) => finding.outcome === "differs").length;
if (values.strict && differing > 0) process.exit(1);
