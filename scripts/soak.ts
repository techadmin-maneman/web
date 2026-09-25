// Lets the production canary serve for a while, then judges it on the errors of
// real visitors' requests (scripts/lib/soak.ts). Exits 1 when the new version
// errors far more than the old, so the release rolls back.
//
//   node scripts/soak.ts --worker mm-api --env production --seconds 300 --new <version-id> --old <version-id>

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { accountIdFor } from "./lib/cloudflare-api.ts";
import { judgeSoak, readInvocations } from "./lib/soak.ts";

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

const reading = await readInvocations({
  token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  accountId: accountIdFor(environment),
  script: `${worker}-${environment}`,
  since,
  until: new Date(),
});
if ("unreadable" in reading) {
  console.log(`::notice::The soak could not read real traffic (${reading.unreadable}); the smoke checks stand alone.`);
  process.exit(0);
}

const none = { requests: 0, errors: 0 };
const verdict = judgeSoak(reading.byVersion[newVersion] ?? none, reading.byVersion[oldVersion] ?? none);
if (verdict.outcome === "failed") {
  console.log(`::error::The canary failed its soak: ${verdict.detail}`);
  process.exit(1);
}
console.log(`soak ${verdict.outcome}: ${verdict.detail}`);
