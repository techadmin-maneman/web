// Lets the production canary serve for a while, then judges it on real
// visitors' requests (scripts/lib/soak.ts): on its errors against the old
// version's, on what each route read from D1, and on how long Home and a job's
// card took. Exits 1 when any fails, so the release rolls back.
//
//   node scripts/soak.ts --worker mm-api --env production --seconds 300 --new <version-id> --old <version-id>

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { accountIdFor } from "./lib/cloudflare-api.ts";
import {
  judgeRouteLatency,
  judgeRouteReads,
  judgeSoak,
  readInvocations,
  readRouteReads,
  type InvocationQuery,
} from "./lib/soak.ts";

const { values } = parseArgs({
  options: {
    worker: { type: "string" },
    env: { type: "string" },
    seconds: { type: "string" },
    new: { type: "string" },
    old: { type: "string" },
  },
});
const environment = values.env;
const seconds = Number(values.seconds);
const { worker, new: newVersion = "", old: oldVersion = "" } = values;
if ((environment !== "staging" && environment !== "production") || worker === undefined || !(seconds >= 0)) {
  console.error("usage: soak.ts --worker <name> --env <staging|production> --seconds <n> --new <id> --old <id>");
  process.exit(2);
}

const since = new Date();
console.log(`${worker}-${environment}: serving ${newVersion} beside ${oldVersion} for ${String(seconds)} s`);
await sleep(seconds * 1000);

const served: InvocationQuery = {
  token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  accountId: accountIdFor(environment),
  script: `${worker}-${environment}`,
  since,
  until: new Date(),
};

/** Whether the new version errored far more than the old one; false when analytics could not be read. */
async function erroredFarMore(): Promise<boolean> {
  const reading = await readInvocations(served);
  if ("unreadable" in reading) {
    console.log(
      `::notice::The soak could not read real traffic (${reading.unreadable}); the smoke checks stand alone.`,
    );
    return false;
  }
  const none = { requests: 0, errors: 0 };
  const verdict = judgeSoak(reading.byVersion[newVersion] ?? none, reading.byVersion[oldVersion] ?? none);
  if (verdict.outcome === "failed") {
    console.log(`::error::The canary failed its soak: ${verdict.detail}`);
    return true;
  }
  console.log(`soak ${verdict.outcome}: ${verdict.detail}`);
  return false;
}

/**
 * Whether a route of the new version read more from D1 than its ceiling, or took longer than its budget; false when
 * Workers Logs could not be read.
 */
async function routesFailed(): Promise<boolean> {
  const reading = await readRouteReads({ ...served, version: newVersion });
  if ("unreadable" in reading) {
    console.log(`::notice::The soak could not read what each route read from D1 (${reading.unreadable}).`);
    return false;
  }
  const reads = judgeRouteReads(reading.byRoute);
  const latency = judgeRouteLatency(reading.byRoute);
  if (reads.outcome === "failed") console.log(`::error::The canary read too much from D1: ${reads.detail}`);
  else console.log(`D1 reads ${reads.outcome}: ${reads.detail}`);
  if (latency.outcome === "failed") console.log(`::error::The canary was too slow: ${latency.detail}`);
  else console.log(`latency ${latency.outcome}: ${latency.detail}`);
  return reads.outcome === "failed" || latency.outcome === "failed";
}

const failed = [await erroredFarMore(), await routesFailed()].includes(true);
if (failed) process.exit(1);
