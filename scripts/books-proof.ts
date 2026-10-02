// Proves the Books provider (src/providers/books.ts) against the owner's org: a customer, an invoice and an item,
// each read back, then the customer erased both ways and the invoice deleted. Every record is named "Staging test".
//
//   node --env-file=.env.books-scripts scripts/books-proof.ts
//
// The file holds ZOHO_BOOKS_CLIENT_ID, ZOHO_BOOKS_CLIENT_SECRET, ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN (the scripts' own:
// scripts/lib/zoho-script-token.ts), ZOHO_BOOKS_ACCOUNTS_HOST, ZOHO_BOOKS_API_HOST and ZOHO_BOOKS_ORG_ID. No secret is
// printed. A run makes about 20 of the 2,000 calls a day Books allows the org, which staging and production share.
//
// The scripts' scopes cannot delete an item, so every run reuses one, "Staging test: proof item", and leaves it.

import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import type { ZohoBooksSettings } from "../src/config/settings.ts";
import { indiaDate } from "../src/lib/india-time.ts";
import type { Logger, LogFields } from "../src/log.ts";
import { createBooksProvider, type NewBooksCustomer } from "../src/providers/books.ts";
import { createZohoRequester, ZohoError } from "../src/providers/zoho-http.ts";
import { refreshTokenForScript } from "./lib/zoho-script-token.ts";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
parseArgs({ options: { "use-worker-token": { type: "boolean", default: false } } });

const PROOF_ITEM = "Staging test: proof item";

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is not set; pass the secrets file with --env-file`);
    process.exit(2);
  }
  return value;
}

const settings: ZohoBooksSettings = {
  clientId: required("ZOHO_BOOKS_CLIENT_ID"),
  clientSecret: required("ZOHO_BOOKS_CLIENT_SECRET"),
  refreshToken: refreshTokenForScript("books"),
  accountsHost: required("ZOHO_BOOKS_ACCOUNTS_HOST"),
  apiHost: required("ZOHO_BOOKS_API_HOST"),
  orgId: required("ZOHO_BOOKS_ORG_ID"),
  refundAccountId: null,
};

/** The one table the requester keeps, in memory: the access token, minted once for the run. */
function tokenTable(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    `CREATE TABLE zoho_access_tokens (client TEXT PRIMARY KEY, access_token TEXT, expires_at TEXT,
       refreshing_until TEXT, cool_down_until TEXT)`,
  );
  const prepare = (sql: string) => ({
    bind: (...values: (string | null)[]) => ({
      first: () => Promise.resolve(sqlite.prepare(sql).get(...values) ?? null),
      run: () => Promise.resolve(sqlite.prepare(sql).run(...values)),
    }),
  });
  return { prepare } as unknown as D1Database;
}

/** Each call the provider made, by step and status, for the record; nothing else it logs. */
const callsMade: string[] = [];
function callLogger(): Logger {
  const note = (event: string, fields?: LogFields) => {
    if (event === "zoho_call") callsMade.push(`${String(fields?.step)} ${String(fields?.status)}`);
  };
  const logger: Logger = { debug: note, info: note, warn: note, error: note, child: () => logger };
  return logger;
}

const deps = { db: tokenTable(), fetch: globalThis.fetch, now: () => new Date(), log: callLogger() };
const books = createBooksProvider("zoho", settings, deps);
const request = createZohoRequester("books", settings, deps);
const org = `organization_id=${encodeURIComponent(settings.orgId)}`;

function check(what: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${what}: ${detail}`);
  if (!passed) process.exitCode = 1;
}

/** The customer as Books now holds it, read past the provider; null once it is deleted. */
async function readCustomer(customerId: string) {
  try {
    const response = await request("read_customer", `/books/v3/contacts/${customerId}?${org}`);
    const { contact } = await response.json<{
      contact: { contact_name: string; status: string; mobile: string; contact_persons: unknown[] };
    }>();
    return contact;
  } catch (error) {
    if (error instanceof ZohoError && error.status === 404) return null;
    throw error;
  }
}

/** The item every run reuses, made by the first, and its rate now. */
async function proofItem(): Promise<{ id: string; rate: number }> {
  const held = (await books.items()).find((item) => item.name === PROOF_ITEM);
  if (held !== undefined) return held;
  return { id: await books.createItem({ name: PROOF_ITEM, rate: 200_000 }), rate: 200_000 };
}

const reference = `staging-proof-${crypto.randomUUID()}`;
const mobile = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const address = {
  street1: "Flat 1, Staging test",
  street2: null,
  city: "Gurgaon",
  state: "Haryana",
  pincode: "122002",
};
const customer: NewBooksCustomer = {
  personId: crypto.randomUUID(),
  name: "Staging test",
  mobile,
  email: null,
  stateCode: null,
  address,
};

let customerId: string | null = null;
let invoiceId: string | null = null;

async function deleteInvoice(id: string): Promise<void> {
  await request("delete_invoice", `/books/v3/invoices/${id}?${org}`, { method: "DELETE" });
}

try {
  customerId = await books.upsertCustomer(customer);
  check("customer added under its person ID", customerId !== "", customerId);
  const again = await books.upsertCustomer({ ...customer, address: { ...address, street1: "Flat 2, Staging test" } });
  check("the same person ID finds the same customer", again === customerId, again);

  const newMobile = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  await books.updateCustomer(customerId, { ...customer, mobile: newMobile });
  check("a new number is written over it", (await readCustomer(customerId))?.mobile === newMobile, "read back");

  try {
    await books.upsertCustomer({ ...customer, stateCode: "HR" });
    check("a place of contact while GST is off", false, "Books took it: GST is on in the org");
  } catch (error) {
    const code = error instanceof ZohoError ? error.code : String(error);
    check("a place of contact is refused while GST is off", code === "8", `code ${code}`);
  }

  const { id: itemId, rate: rateBefore } = await proofItem();
  const rate = rateBefore === 200_000 ? 250_000 : 200_000;
  await books.updateItem(itemId, { name: PROOF_ITEM, rate });
  const item = (await books.items()).find((each) => each.id === itemId);
  const moved = `${itemId} from ${String(rateBefore)} to ${String(item?.rate)} paise`;
  check("a new rate is written over the proof item", item?.rate === rate, moved);

  check("no invoice under a new reference", (await books.findInvoice(reference)) === null, reference);
  const line = {
    itemId,
    name: "Staging test: first fit",
    description: "Staging test",
    rate: 200_000,
    discount: 15_000,
  };
  const date = indiaDate(new Date());
  const invoice = await books.createInvoice({ customerId, reference, date, placeOfSupply: null, line });
  invoiceId = invoice.id;
  check("a draft for ₹2,000 less ₹150 totals ₹1,850", invoice.total === 185_000, `${invoice.number} ${invoice.status}`);
  const found = await books.findInvoice(reference);
  check("the invoice is found by its reference", found?.id === invoice.id, String(found?.number));

  const kept = await books.eraseCustomer(customerId);
  const blanked = await readCustomer(customerId);
  const blank = blanked?.contact_name === "Erased client" && blanked.mobile === "" && blanked.status === "inactive";
  check("a customer an invoice names is blanked and inactive", kept === "blanked" && blank, kept);

  await deleteInvoice(invoice.id);
  invoiceId = null;
  const gone = await books.eraseCustomer(customerId);
  check("with no invoice left, it is deleted", gone === "deleted" && (await readCustomer(customerId)) === null, gone);
  customerId = null;
} finally {
  if (invoiceId !== null) await deleteInvoice(invoiceId);
  if (customerId !== null) await books.eraseCustomer(customerId);
  console.log(`\nCalls made: ${callsMade.join(", ")}`);
}
