// Worker version bookkeeping for the deploy workflows. The logic is in
// scripts/lib/release.ts; see docs/decisions/0006-deployment-pipeline.md.
//
//   node scripts/release/release.ts current --worker mm-api --env production
//       Prints the version serving 100% of traffic. Prints "" for an app whose
//       surface is not switched on there, deployed or not; anything else
//       Cloudflare cannot answer is an error.
//   node scripts/release/release.ts upload --worker mm-api --env production --tag <git-sha>
//       Uploads a new version without sending it any traffic. Prints its ID.
//   node scripts/release/release.ts deploy --worker mm-api --env production --split <id>@10 --split <id>@90
//       Sets how traffic is split between versions. Percentages must total 100.
//   node scripts/release/release.ts ship --worker mm-app --env staging --tag <git-sha>
//       Uploads a version and sends it all traffic; an app whose surface is off is left alone.
//   node scripts/release/release.ts restore --env production --to mm-api=<id> --to mm-app=<id-or-empty> …
//       Puts each Worker back on the version recorded before a release. Tries every one, then fails if any failed.

import { parseArgs } from "node:util";
import {
  currentVersion,
  deploySplit,
  restore,
  ship,
  uploadVersion,
  wranglerFor,
  type Environment,
  type Target,
} from "../lib/release.ts";
import { isWorkerName, WORKERS, workerNamed, type WorkerName } from "../lib/workers.ts";

function targetFor(name: WorkerName, environment: Environment): Target {
  const worker = workerNamed(name);
  return { worker, environment, wrangler: wranglerFor(worker, environment) };
}

function usage(): never {
  const names = WORKERS.map((entry) => entry.name).join("|");
  console.error(
    `usage: release.ts <current|upload|deploy|ship> --worker <${names}> --env <staging|production> …\n` +
      "       release.ts restore --env <staging|production> --to <worker>=<version-id> …",
  );
  process.exit(2);
}

/** Restores every Worker named, even after one fails, so a rollback does as much as it can. */
function restoreAll(environment: Environment, pairs: readonly string[], message: string): void {
  let failed = 0;
  for (const pair of pairs) {
    const [name, version = ""] = pair.split("=");
    if (!isWorkerName(name)) usage();
    try {
      console.log(`${name}-${environment}: ${restore(targetFor(name, environment), version, message)}`);
    } catch (error) {
      failed++;
      console.log(`::error::${name}-${environment} was not restored: ${error instanceof Error ? error.message : ""}`);
    }
  }
  if (failed > 0) process.exit(1);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    worker: { type: "string" },
    env: { type: "string" },
    tag: { type: "string" },
    message: { type: "string" },
    split: { type: "string", multiple: true },
    to: { type: "string", multiple: true },
  },
});

const environment = values.env;
if (environment !== "staging" && environment !== "production") usage();

const command = positionals[0] ?? "";
if (command === "restore") {
  restoreAll(environment, values.to ?? [], values.message ?? "rollback");
  process.exit(0);
}

const name = values.worker;
if (!isWorkerName(name)) usage();
const target = targetFor(name, environment);

switch (command) {
  case "current":
    console.log(currentVersion(target));
    break;
  case "upload": {
    const tag = values.tag ?? usage();
    console.log(uploadVersion(target, tag, values.message ?? `release ${tag}`));
    break;
  }
  case "deploy": {
    const splits = values.split ?? [];
    deploySplit(target, splits, values.message ?? `split ${splits.join(" ")}`);
    break;
  }
  case "ship": {
    const tag = values.tag ?? usage();
    const version = ship(target, tag, values.message ?? `release ${tag}`);
    if (version === null) {
      console.log(
        `::notice::${name}-${environment} is not deployed yet, so it is not released (docs/runbook.md, step 11)`,
      );
    }
    break;
  }
  default:
    usage();
}
