// Checks, before every release, that the Zoho Books org is set up the way invoices need: the organisation, its
// invoice discount preference, Mane Man's GST identity and the refund account (scripts/lib/books-org-check.ts).
// Read-only: it changes nothing in Books. Each service's item is the Worker's own hourly check.
//
//   node --env-file=.env.books-scripts scripts/check-books-setup.ts [--env staging|production]
//
// The file holds ZOHO_BOOKS_CLIENT_ID, ZOHO_BOOKS_CLIENT_SECRET, ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN (the scripts' own:
// scripts/lib/zoho-script-token.ts), ZOHO_BOOKS_ACCOUNTS_HOST, ZOHO_BOOKS_API_HOST and ZOHO_BOOKS_ORG_ID. The GSTIN,
// its state and the refund account are read from wrangler.jsonc, for the environment named (staging unless said). No
// secret is printed. A run makes three of the 2,000 calls a day Books allows the org.

import { parseArgs } from "node:util";
import {
  discountPreference,
  gstIdentity,
  organisation,
  refundAccount,
  type BooksAnswer,
  type CheckLine,
} from "./lib/books-org-check.ts";
import { readJsonc } from "./lib/jsonc.ts";
import { refreshTokenForScript } from "./lib/zoho-script-token.ts";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: {
    env: { type: "string", default: "staging" },
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

/** A var the Worker of this environment carries in wrangler.jsonc; null where it is empty. */
function workerVar(environment: string, name: string): string | null {
  const config = readJsonc("wrangler.jsonc") as { env?: Record<string, { vars?: Record<string, string> }> };
  const value = config.env?.[environment]?.vars?.[name]?.trim() ?? "";
  return value === "" ? null : value;
}

if (values.env !== "staging" && values.env !== "production") {
  console.error("--env is staging or production");
  process.exit(2);
}
const environment = values.env;
const apiHost = required("ZOHO_BOOKS_API_HOST");
const orgId = required("ZOHO_BOOKS_ORG_ID");

async function accessToken(): Promise<string> {
  const query = new URLSearchParams({
    refresh_token: refreshTokenForScript("books"),
    client_id: required("ZOHO_BOOKS_CLIENT_ID"),
    client_secret: required("ZOHO_BOOKS_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const response = await fetch(`https://${required("ZOHO_BOOKS_ACCOUNTS_HOST")}/oauth/v2/token?${query.toString()}`, {
    method: "POST",
  });
  const body = await response.json<{ access_token?: string; error?: string }>();
  if (body.access_token === undefined) {
    console.error(`FAIL  token: Zoho refused the refresh token (${body.error ?? String(response.status)})`);
    process.exit(1);
  }
  return body.access_token;
}

const token = await accessToken();

/** One read of Books, in the owner's organisation. */
async function read(path: string): Promise<BooksAnswer> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`https://${apiHost}/books/v3${path}${separator}organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : (JSON.parse(text) as unknown) };
}

const refundAccountId = workerVar(environment, "BOOKS_REFUND_ACCOUNT_ID");
const organisationAnswer = (await read(`/organizations/${orgId}`)).json;
const lines: CheckLine[] = [
  organisation(organisationAnswer),
  discountPreference((await read("/settings/invoices")).json),
  ...gstIdentity(
    { gstin: workerVar(environment, "BOOKS_GSTIN"), stateCode: workerVar(environment, "BOOKS_GST_STATE") },
    organisationAnswer,
  ),
  refundAccount(refundAccountId, refundAccountId === null ? null : await read(`/bankaccounts/${refundAccountId}`)),
];

for (const line of lines) console.log(`${line.outcome.toUpperCase().padEnd(4)}  ${line.check}: ${line.detail}`);
const failures = lines.filter((line) => line.outcome === "fail").length;
if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed`);
  process.exit(1);
}
console.log(`\nThe Books org is set up as ${environment}'s invoices need.`);
