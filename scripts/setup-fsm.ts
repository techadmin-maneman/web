// Sets up the Zoho FSM org the way the mirror expects
// (docs/decisions/0032-fsm-mirror.md), and checks the FSM and Books client.
// It creates only what is missing, by name, so it is safe to run again.
//
//   node --env-file=.env.fsm-staging scripts/setup-fsm.ts --check   read-only
//   node --env-file=.env.fsm-staging scripts/setup-fsm.ts           creates what is missing
//
// The file holds ZOHO_FSM_CLIENT_ID, ZOHO_FSM_CLIENT_SECRET,
// ZOHO_FSM_SCRIPTS_REFRESH_TOKEN (the scripts' own, never the Worker's:
// scripts/lib/zoho-script-token.ts), ZOHO_FSM_ACCOUNTS_HOST, ZOHO_FSM_API_HOST
// and ZOHO_BOOKS_ORG_ID. No secret is printed.

import { parseArgs } from "node:util";
import { FSM_BASE_PART_NAME, FSM_STANDARD_ITEMS, type StandardKind } from "../src/config/visit-types.ts";
import { refreshTokenForScript } from "./lib/zoho-script-token.ts";

/**
 * A new standard item's price in rupees before GST: the price book's own since
 * 22 September 2026 (migration 0018), so a new org starts in line with it. FSM
 * prices its invoices from these. The cron's hourly check compares them with
 * the book afterwards, and the push keeps them in line once the owner switches
 * it on (docs/decisions/0073-prices-from-the-price-book.md). An item that
 * already exists is left as it is. A first fit has no standard item: each hair
 * system ops add in the console needs its own, made in FSM by hand or by the push.
 */
const NEW_ITEM_PRICES: Readonly<Record<StandardKind, number>> = {
  consultation: 0,
  service: 2_000,
  replacement: 15_000,
};
/** The base part, which the price book does not price: a placeholder (docs/open-points.md, item 1). */
const PLACEHOLDER_BASE_PRICE = 30_000;

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: { check: { type: "boolean", default: false }, "use-worker-token": { type: "boolean", default: false } },
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
const booksOrgId = required("ZOHO_BOOKS_ORG_ID");

let failures = 0;
function report(ok: boolean, check: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}: ${detail}`);
}

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
  const body = await response.json<{ access_token?: string; error?: string; scope?: string }>();
  if (body.access_token === undefined) {
    console.error(`FAIL  token: Zoho refused the refresh token (${body.error ?? String(response.status)})`);
    process.exit(1);
  }
  report(true, "token", `issued; scope ${body.scope ?? "(not returned)"}`);
  return body.access_token;
}

const token = await accessToken();

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`https://${apiHost}${path}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : (JSON.parse(text) as unknown) };
}

interface Item {
  id: string;
  Name: string;
  Type: string;
}

async function items(): Promise<Item[]> {
  const answer = await call("GET", "/fsm/v1/Service_And_Parts?per_page=200");
  return (answer.json as { data?: Item[] } | null)?.data ?? [];
}

// The technicians: FSM's users with a service resource.
const users = await call("GET", "/fsm/v1/users");
const technicians = (
  (users.json as { users?: { Service_Resources?: { isActive?: boolean } | null }[] } | null)?.users ?? []
).filter((user) => (user.Service_Resources ?? null) !== null);
report(
  technicians.length > 0,
  "technicians",
  `${String(technicians.length)} user(s) with a service resource, ${String(technicians.filter((user) => user.Service_Resources?.isActive === true).length)} active`,
);

// The territories.
const territories = await call("GET", "/fsm/v1/Territories");
const territoryCount = (territories.json as { data?: unknown[] } | null)?.data?.length ?? 0;
report(territoryCount > 0, "territories", String(territoryCount));

// The catalogue: a service item per standard service, and the base part.
const wanted: { name: string; type: "Service" | "Part"; price: number }[] = [
  ...FSM_STANDARD_ITEMS.map(({ kind, name }) => ({
    name,
    type: "Service" as const,
    price: NEW_ITEM_PRICES[kind],
  })),
  { name: FSM_BASE_PART_NAME, type: "Part", price: PLACEHOLDER_BASE_PRICE },
];
const existing = await items();
for (const item of wanted) {
  const found = existing.find((candidate) => candidate.Name === item.name);
  if (found !== undefined) {
    report(
      found.Type === item.type,
      `item "${item.name}"`,
      found.Type === item.type ? "present" : `present, but a ${found.Type}`,
    );
    continue;
  }
  if (values.check) {
    report(false, `item "${item.name}"`, "missing; run without --check to create it");
    continue;
  }
  const created = await call("POST", "/fsm/v1/Service_And_Parts", {
    data: [
      {
        Name: item.name,
        Type: item.type,
        Unit_Price: item.price,
        Description: "Placeholder price: see docs/open-points.md",
      },
    ],
  });
  report(
    created.status === 201,
    `item "${item.name}"`,
    created.status === 201 ? "created" : `refused (HTTP ${String(created.status)})`,
  );
}

// Books: the organisation the invoices are in.
const organisation = await call("GET", `/books/v3/organizations/${booksOrgId}`);
const org = (organisation.json as { organization?: { name?: string; currency_code?: string } } | null)?.organization;
report(
  org !== undefined,
  "Books organisation",
  org === undefined
    ? `not found (HTTP ${String(organisation.status)})`
    : `${org.name ?? "?"}, ${org.currency_code ?? "?"}`,
);

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed`);
  process.exit(1);
}
console.log("\nThe FSM org is set up as the mirror expects.");
