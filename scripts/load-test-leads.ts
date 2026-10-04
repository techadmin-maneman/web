// M4's load test, on the site's booking form: 50 concurrent submissions, and no duplicates.
//
//   node --env-file=.env.staging-access scripts/load-test-leads.ts [--people 25]
//
// Each test person ("Load test", a random 9xxxxxxxxx number) books a consultation twice at the same moment with the
// same Idempotency-Key, as a double-tapped submit would be. Every request goes out at once. Expected: every answer is
// 201, the first booking or the replay of it, or 409 idempotency_in_progress while the first is still running; and
// in D1, one lead per person.
//
// It runs against a staging version with SELF_SERVE_BOOKING "false" and the per-address limit, LEAD_IP_DAILY_LIMIT,
// raised above twice the people (docs/verification.md). With self-serve booking off each booking is a request for
// ops, the day and window asked for, and nothing is booked: the test books no work, nor anything in the org staging
// shares with production (docs/decisions/0025-phase-2-conflicts-register.md, item 26). A "booked" answer means the
// version holds slots, and the test stops at once. The leads reach the CRM, named "Load test".
//
// The count is read from staging's D1 with wrangler, so CLOUDFLARE_API_TOKEN must be staging's as well.

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { consultationBody, lastBookableDay, testMobile } from "./lib/test-booking.ts";

const run = promisify(execFile);
const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
/** Cloudflare Access's service token, for staging's host. */
const ACCESS = {
  "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
};

const { values } = parseArgs({
  options: {
    people: { type: "string", default: "25" },
    pincode: { type: "string", default: "122018" },
    city: { type: "string", default: "Gurgaon" },
    base: { type: "string", default: "https://staging.maneman.in" },
  },
});
const people = Number(values.people);
const runId = `load-${String(Date.now())}`;
const date = lastBookableDay();

interface Outcome {
  readonly person: number;
  readonly status: number;
  readonly state: string | null;
  readonly code: string | null;
  readonly ms: number;
}

async function submit(person: number, mobile: string): Promise<Outcome> {
  const started = Date.now();
  const response = await fetch(`${values.base}/api/consultation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `${runId}-${String(person)}`,
      ...ACCESS,
    },
    body: JSON.stringify(
      consultationBody({
        name: "Load test",
        mobile,
        pincode: values.pincode,
        city: values.city,
        date,
        window: "morning",
      }),
    ),
    redirect: "manual",
  });
  const body = (await response.json().catch(() => ({}))) as { state?: string; error?: { code?: string } };
  return {
    person,
    status: response.status,
    state: body.state ?? null,
    code: body.error?.code ?? null,
    ms: Date.now() - started,
  };
}

/** How many leads each number has in staging's D1. */
async function leadsPerNumber(mobiles: readonly string[]): Promise<Map<string, number>> {
  const numbers = mobiles.map((mobile) => `'+91${mobile}'`).join(", ");
  const sql = `SELECT p.mobile_e164 AS mobile, COUNT(l.id) AS leads FROM people p JOIN leads l ON l.person_id = p.id
    WHERE p.mobile_e164 IN (${numbers}) GROUP BY p.mobile_e164`;
  const { stdout } = await run(process.execPath, [
    WRANGLER,
    "d1",
    "execute",
    "maneman-staging",
    "--env",
    "staging",
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  const [answer] = JSON.parse(stdout) as { results: { mobile: string; leads: number }[] }[];
  return new Map((answer?.results ?? []).map((row) => [row.mobile.slice(3), row.leads]));
}

const mobiles = Array.from({ length: people }, () => testMobile());
const started = Date.now();
const outcomes = await Promise.all(
  mobiles.flatMap((mobile, person) => [submit(person, mobile), submit(person, mobile)]),
);
const elapsed = Date.now() - started;

const byAnswer = new Map<string, number>();
for (const outcome of outcomes) {
  const key = `${String(outcome.status)} ${outcome.state ?? outcome.code ?? ""}`.trim();
  byAnswer.set(key, (byAnswer.get(key) ?? 0) + 1);
}
const durations = outcomes.map((o) => o.ms).sort((a, b) => a - b);
console.log(`run ${runId}: ${String(outcomes.length)} requests for ${String(people)} people in ${String(elapsed)} ms`);
console.log(`answers: ${[...byAnswer].map(([key, count]) => `${key} x${String(count)}`).join(", ")}`);
console.log(
  `latency: median ${String(durations[Math.floor(durations.length / 2)] ?? 0)} ms, slowest ${String(durations.at(-1) ?? 0)} ms`,
);
console.log(`numbers used: ${mobiles.map((m) => `…${m.slice(-4)}`).join(" ")}`);

if (outcomes.some((o) => o.state === "booked")) {
  console.error("This version holds slots, so visits were booked: run the test on one with SELF_SERVE_BOOKING false.");
  process.exit(1);
}
const expected = (o: Outcome) => o.status === 201 || o.code === "idempotency_in_progress";
if (!outcomes.every(expected)) process.exit(1);

const leads = await leadsPerNumber(mobiles);
const counts = mobiles.map((mobile) => leads.get(mobile) ?? 0);
console.log(`leads per person in D1: ${[...new Set(counts)].join(", ")} (1 means no duplicate)`);
if (counts.some((count) => count !== 1)) process.exit(1);
