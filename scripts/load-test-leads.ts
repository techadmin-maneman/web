// M4's load test: 50 concurrent lead submissions, and no duplicates.
//
//   node --env-file=.env.staging-access scripts/load-test-leads.ts [--people 25]
//
// Each test person (a random 9xxxxxxxxx number, name "Load test") is booked
// twice at the same moment with the same Idempotency-Key, as a double-tapped
// submit would be. Every request goes out at once. Expected: one lead per
// person, and the second request of each pair either replays the first
// response (201, same lead_id) or is told the first is still running (409).
//
// Staging's per-address limit (20 leads a day) is below 50, so the test runs
// against a staging version with the limits raised (docs/verification.md).

import { parseArgs } from "node:util";
import { TURNSTILE_TEST_TOKEN } from "../src/providers/turnstile.ts";

const { values } = parseArgs({
  options: {
    people: { type: "string", default: "25" },
    base: { type: "string", default: "https://staging.maneman.in" },
  },
});
const people = Number(values.people);
const run = `load-${String(Date.now())}`;

interface Outcome {
  readonly person: number;
  readonly status: number;
  readonly leadId: string | null;
  readonly code: string | null;
  readonly ms: number;
}

async function submit(person: number, mobile: string): Promise<Outcome> {
  const started = Date.now();
  const response = await fetch(`${values.base}/api/lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `${run}-${String(person)}`,
      "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
      "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
    },
    body: JSON.stringify({
      name: "Load test",
      mobile,
      city: "Noida",
      first_choice_window: "weekend_am",
      loss_extent: "receding",
      consent: true,
      turnstile_token: TURNSTILE_TEST_TOKEN,
    }),
    redirect: "manual",
  });
  const body = (await response.json().catch(() => ({}))) as { lead_id?: string; error?: { code?: string } };
  return {
    person,
    status: response.status,
    leadId: body.lead_id ?? null,
    code: body.error?.code ?? null,
    ms: Date.now() - started,
  };
}

const mobiles = Array.from({ length: people }, () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`);
const started = Date.now();
const outcomes = await Promise.all(
  mobiles.flatMap((mobile, person) => [submit(person, mobile), submit(person, mobile)]),
);
const elapsed = Date.now() - started;

const byStatus = new Map<string, number>();
for (const outcome of outcomes) {
  const key = `${String(outcome.status)}${outcome.code === null ? "" : ` ${outcome.code}`}`;
  byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
}
const leadsPerPerson = mobiles.map(
  (_mobile, person) =>
    new Set(outcomes.filter((o) => o.person === person && o.leadId !== null).map((o) => o.leadId)).size,
);
const durations = outcomes.map((o) => o.ms).sort((a, b) => a - b);

console.log(`run ${run}: ${String(outcomes.length)} requests for ${String(people)} people in ${String(elapsed)} ms`);
console.log(`responses: ${[...byStatus].map(([key, count]) => `${key} x${String(count)}`).join(", ")}`);
console.log(`distinct lead IDs per person: ${[...new Set(leadsPerPerson)].join(", ")} (1 means no duplicate)`);
console.log(
  `latency: median ${String(durations[Math.floor(durations.length / 2)] ?? 0)} ms, slowest ${String(durations.at(-1) ?? 0)} ms`,
);
console.log(`numbers used: ${mobiles.map((m) => `…${m.slice(-4)}`).join(" ")}`);
if (leadsPerPerson.some((count) => count !== 1)) process.exit(1);
