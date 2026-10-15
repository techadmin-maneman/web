// Lets the production canary serve for a while, then judges it on real
// visitors' requests (scripts/lib/soak.ts): on its errors and its 5xx answers
// against the old version's, on what each route read from D1, and on how long
// Home and a job's card took. Exits 1 when any fails, so the release rolls back.
// In production it exits 1 as well when it could not judge one of them, for
// too little traffic or a reading Cloudflare would not give, unless the
// release was started accepting that.
//
//   node scripts/release/soak.ts --worker mm-api --env production --seconds 300 --new <version-id> --old <version-id> [--accept-unjudged true]

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { accountIdFor, databaseIdFor } from "../lib/cloudflare-api.ts";
import {
  busiestWeek,
  judgeRouteLatency,
  judgeRouteReads,
  judgeSoak,
  readInvocations,
  type InvocationQuery,
  type Reading,
  type Verdict,
} from "../lib/soak.ts";
import { readAnswers, readRouteReads, readVisitsByDay } from "../lib/soak-reads.ts";
import { routeRowsRead } from "../lib/usage-budget.ts";

const { values } = parseArgs({
  options: {
    worker: { type: "string" },
    env: { type: "string" },
    seconds: { type: "string" },
    new: { type: "string" },
    old: { type: "string" },
    "accept-unjudged": { type: "string" },
  },
});
const environment = values.env;
const seconds = Number(values.seconds);
const { worker, new: newVersion = "", old: oldVersion = "" } = values;
if ((environment !== "staging" && environment !== "production") || worker === undefined || !(seconds >= 0)) {
  console.error("usage: soak.ts --worker <name> --env <staging|production> --seconds <n> --new <id> --old <id>");
  process.exit(2);
}
const acceptUnjudged = values["accept-unjudged"] === "true";

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
const databaseId = databaseIdFor(environment);

/** What the soak could not judge, each with why. */
const unjudged: string[] = [];

/** Whether the verdict on `subject` failed the canary, saying so; one not judged is kept for the end. */
function failedOn(subject: string, verdict: Verdict): boolean {
  if (verdict.outcome === "failed") {
    console.log(`::error::The canary failed on ${subject}: ${verdict.detail}`);
    return true;
  }
  if (verdict.outcome === "not judged") unjudged.push(`${subject}: ${verdict.detail}`);
  console.log(`${subject} ${verdict.outcome}: ${verdict.detail}`);
  return false;
}

function cannotRead(subject: string, why: string): false {
  unjudged.push(`${subject}: ${why}`);
  console.log(`::notice::The soak could not judge ${subject} (${why}).`);
  return false;
}

/** Whether the new version errored far more than the old one, by `reading`. */
function erroredFarMore(subject: string, reading: Reading): boolean {
  if ("unreadable" in reading) return cannotRead(subject, reading.unreadable);
  const none = { requests: 0, errors: 0 };
  return failedOn(subject, judgeSoak(reading.byVersion[newVersion] ?? none, reading.byVersion[oldVersion] ?? none));
}

/** The dispatch board's ceiling grows with its busiest week; unread, the board is left out and the rest judged. */
async function routeCeilings(): Promise<Readonly<Record<string, number>> | null> {
  const visits = await readVisitsByDay({ ...served, databaseId });
  if ("unreadable" in visits) {
    cannotRead("the dispatch board's reads", visits.unreadable);
    return null;
  }
  const week = busiestWeek(visits.byDay);
  console.log(`the dispatch board's busiest week holds ${String(week)} visits`);
  return routeRowsRead(week);
}

/** Whether a route of the new version read more from D1 than its ceiling, or took longer than its budget. */
async function routesFailed(): Promise<boolean> {
  const reading = await readRouteReads({ ...served, version: newVersion });
  if ("unreadable" in reading)
    return cannotRead("what each route read from D1, and how long it took", reading.unreadable);
  const ceilings = await routeCeilings();
  const byRoute = { ...reading.byRoute };
  if (ceilings === null) delete byRoute["/api/dispatch"];
  const reads = failedOn("D1 reads", judgeRouteReads(byRoute, ceilings ?? {}));
  const latency = failedOn("latency", judgeRouteLatency(reading.byRoute));
  return reads || latency;
}

const failed = [
  erroredFarMore("errors", await readInvocations(served)),
  erroredFarMore("5xx answers", await readAnswers(served)),
  await routesFailed(),
].includes(true);
if (failed) process.exit(1);

if (environment === "production" && unjudged.length > 0) {
  const why = unjudged.join("; ");
  if (!acceptUnjudged) {
    console.log(
      `::error::The soak could not judge the canary (${why}). To promote it on the smoke checks alone, start the release again with accept_unjudged_soak.`,
    );
    process.exit(1);
  }
  console.log(`::warning::Promoted on the smoke checks alone, as the release was started accepting: ${why}`);
}
