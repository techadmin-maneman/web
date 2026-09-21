// Erases a person the day they ask: docs/decisions/0019-erasure.md and the
// runbook's "Erasure within the day".
//
//   node --env-file=.env.erasure-production scripts/erase-person.ts --environment production
//
// The env file holds ERASURE_SECRET, and for staging also CF_ACCESS_CLIENT_ID
// and CF_ACCESS_CLIENT_SECRET. The number is asked for, not passed as an
// argument, so it stays out of shell history.

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const BASES = { staging: "https://staging.maneman.in", production: "https://maneman.in" } as const;

const { values } = parseArgs({ options: { environment: { type: "string" }, base: { type: "string" } } });
const environment = values.environment;
if (environment !== "staging" && environment !== "production") {
  console.error("usage: erase-person --environment <staging|production> [--base <url>]");
  process.exit(2);
}
// wrangler's generated types say ERASURE_SECRET is always set; here it comes from the env file, if at all.
const variables: Record<string, string | undefined> = process.env;
const secret = variables.ERASURE_SECRET ?? "";
if (secret === "") {
  console.error("ERASURE_SECRET is not set: run with --env-file pointing at a file that holds it");
  process.exit(2);
}

// Lines are read through an iterator so that piped answers work as well as typed ones.
const reader = createInterface({ input: stdin });
const lines = reader[Symbol.asyncIterator]();
async function ask(question: string): Promise<string> {
  stdout.write(question);
  const next = await lines.next();
  return next.done === true ? "" : next.value.trim();
}

const mobile = await ask("Mobile number to erase: ");
const answer = await ask(`Erase the person with this number on ${environment}? It cannot be undone. Type yes: `);
reader.close();
if (answer !== "yes") {
  console.log("Nothing erased.");
  process.exit(1);
}

const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${secret}` };
const accessId = process.env.CF_ACCESS_CLIENT_ID ?? "";
const accessSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
if (accessId !== "" && accessSecret !== "") {
  headers["CF-Access-Client-Id"] = accessId;
  headers["CF-Access-Client-Secret"] = accessSecret;
}

const response = await fetch(`${values.base ?? BASES[environment]}/api/erasure`, {
  method: "POST",
  headers,
  body: JSON.stringify({ mobile }),
});
const body: unknown = await response.json().catch(() => null);

if (response.status === 200) {
  const summary = body as {
    person_id: string;
    erased_at: string;
    photos_deleted: number;
    results_deleted: number;
    messages_cancelled: number;
  };
  console.log(`Erased person ${summary.person_id} at ${summary.erased_at}.`);
  console.log(`  photos deleted:      ${String(summary.photos_deleted)}`);
  console.log(`  results deleted:     ${String(summary.results_deleted)}`);
  console.log(`  messages cancelled:  ${String(summary.messages_cancelled)}`);
  console.log("  CRM:                 queued; blanked within a few minutes. To check:");
  console.log(`  SELECT crm_erased_at, crm_erasure_error FROM people WHERE id = '${summary.person_id}';`);
} else if (response.status === 404) {
  console.log("No one has this number, or they were erased already. Check the number and try again.");
  process.exit(1);
} else if (response.status === 401) {
  console.log("The secret was refused: ERASURE_SECRET in the env file does not match the Worker's.");
  process.exit(1);
} else {
  // Error bodies carry a code and a request ID, never personal data.
  console.log(`Erasure failed with HTTP ${String(response.status)}: ${JSON.stringify(body)}`);
  process.exit(1);
}
