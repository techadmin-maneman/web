// Keeps on each staging client the Books customer FSM's own Books integration made for them, as staging leaves FSM
// (docs/runbook.md, "Switching staging off FSM"). Without it, the Books pass would make each of them a second customer
// under their person ID. Safe to run again: a client is linked once.
//
//   node --env-file=.env.fsm-scripts scripts/link-books-customers.ts           lists what it would link
//   node --env-file=.env.fsm-scripts scripts/link-books-customers.ts --write   links them
//
// Staging only: every call names maneman-staging and passes --env staging; production never had FSM. The file holds
// ZOHO_FSM_CLIENT_ID, ZOHO_FSM_CLIENT_SECRET, ZOHO_FSM_SCRIPTS_REFRESH_TOKEN (scripts/lib/zoho-script-token.ts),
// ZOHO_FSM_ACCOUNTS_HOST and ZOHO_FSM_API_HOST. It reads one FSM contact a client and prints IDs only.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  linkStatement,
  planLinks,
  readContactAnswer,
  type FsmContactRead,
  type UnlinkedPerson,
} from "./lib/link-books-customers.ts";
import { refreshTokenForScript } from "./lib/zoho-script-token.ts";

const DATABASE = "maneman-staging";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: {
    write: { type: "boolean", default: false },
    "use-worker-token": { type: "boolean", default: false },
  },
});

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is not set; pass the secrets file with --env-file`);
    process.exit(2);
  }
  return value;
}

const apiHost = required("ZOHO_FSM_API_HOST");

async function accessToken(): Promise<string> {
  const query = new URLSearchParams({
    refresh_token: refreshTokenForScript("fsm"),
    client_id: required("ZOHO_FSM_CLIENT_ID"),
    client_secret: required("ZOHO_FSM_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const response = await fetch(`https://${required("ZOHO_FSM_ACCOUNTS_HOST")}/oauth/v2/token?${query.toString()}`, {
    method: "POST",
  });
  const body = await response.json<{ access_token?: string; error?: string }>();
  if (body.access_token === undefined) {
    console.error(`Zoho refused the refresh token (${body.error ?? String(response.status)})`);
    process.exit(1);
  }
  return body.access_token;
}

function wrangler(args: readonly string[]): string {
  return execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", DATABASE, "--remote", "--env", "staging", ...args],
    { encoding: "utf8" },
  );
}

function query<T>(sql: string): T[] {
  const output = wrangler(["--json", "--command", sql]);
  // wrangler prints its banner before the JSON when the terminal is not a TTY.
  const answers = JSON.parse(output.slice(output.indexOf("["))) as { results: T[] }[];
  return answers[0]?.results ?? [];
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readContact(contactId: string, token: string): Promise<FsmContactRead> {
  const response = await fetch(`https://${apiHost}/fsm/v1/Contacts/${encodeURIComponent(contactId)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  return readContactAnswer(response.status, jsonOrNull(await response.text()));
}

function applyLinks(statements: readonly string[]): void {
  const folder = mkdtempSync(join(tmpdir(), "mm-link-books-"));
  try {
    const path = join(folder, "links.sql");
    writeFileSync(path, statements.join("\n"));
    wrangler(["--file", path, "--yes"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const people = query<UnlinkedPerson>(
  "SELECT id, fsm_contact_id FROM people WHERE fsm_contact_id IS NOT NULL AND books_customer_id IS NULL ORDER BY created_at",
);
const taken = new Set(
  query<{ books_customer_id: string }>("SELECT books_customer_id FROM people WHERE books_customer_id IS NOT NULL").map(
    (row) => row.books_customer_id,
  ),
);

const token = await accessToken();
const reads = new Map<string, FsmContactRead>();
for (const person of people) reads.set(person.fsm_contact_id, await readContact(person.fsm_contact_id, token));
const plan = planLinks(people, reads, taken);

for (const link of plan.links) console.log(`link  ${link.personId}  Books customer ${link.customerId}`);
for (const skip of plan.skipped) console.log(`skip  ${skip.personId}  ${skip.reason}`);
console.log(`\n${String(plan.links.length)} to link, ${String(plan.skipped.length)} skipped.`);

if (!values.write) {
  console.log("Nothing was written. Run again with --write to link them.");
} else if (plan.links.length > 0) {
  const now = new Date();
  applyLinks(plan.links.map((link) => linkStatement(link, now)));
  console.log("Linked. Once staging is off FSM, the Books pass writes each client's details and ID to their customer.");
}
