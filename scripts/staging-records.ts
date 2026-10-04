// Lists every record staging wrote into the owner's real Zoho org, in Books and the CRM, for the owner to review; a
// second run deletes the Books records the list keeps (docs/open-points.md, items 19 and 155; docs/runbook.md,
// "Staging's records in the org"). The CRM's leads are listed for the owner to delete in the CRM, where the scripts'
// CRM token may read them (ZohoCRM.modules.leads.READ): it deletes none.
//
//   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/staging-records.ts         lists
//   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/staging-records.ts --delete <file>
//
// The files hold each client's ID, secret and hosts, ZOHO_BOOKS_ORG_ID, and the scripts' own refresh tokens,
// ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN and ZOHO_SCRIPTS_REFRESH_TOKEN (scripts/lib/zoho-script-token.ts). No secret is
// printed. Nothing is deleted without --delete, and then only a record the owner's list keeps that the org, read
// again, still marks as staging's (scripts/lib/staging-records.ts).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  isStagingLabelled,
  isStagingMarked,
  leftAlone,
  looksLikeATest,
  toDelete,
  type RecordKind,
  type StagingRecord,
} from "./lib/staging-records.ts";
import { refreshTokenForScript, type ZohoClient } from "./lib/zoho-script-token.ts";
import { indiaDate } from "../src/lib/india-time.ts";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: { delete: { type: "string" }, "use-worker-token": { type: "boolean", default: false } },
});

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is not set; pass the secrets files with --env-file`);
    process.exit(2);
  }
  return value;
}

/** Each client's variables: its ID, secret and hosts. */
const CLIENTS: Readonly<Record<ZohoClient, { readonly prefix: string }>> = {
  books: { prefix: "ZOHO_BOOKS_" },
  crm: { prefix: "ZOHO_" },
};

async function accessToken(client: ZohoClient): Promise<string> {
  const { prefix } = CLIENTS[client];
  const query = new URLSearchParams({
    refresh_token: refreshTokenForScript(client),
    client_id: required(`${prefix}CLIENT_ID`),
    client_secret: required(`${prefix}CLIENT_SECRET`),
    grant_type: "refresh_token",
  });
  const response = await fetch(`https://${required(`${prefix}ACCOUNTS_HOST`)}/oauth/v2/token?${query.toString()}`, {
    method: "POST",
  });
  const body = await response.json<{ access_token?: string; error?: string }>();
  if (body.access_token === undefined) {
    console.error(`Zoho refused the ${client} refresh token (${body.error ?? String(response.status)})`);
    process.exit(1);
  }
  return body.access_token;
}

const booksHost = required("ZOHO_BOOKS_API_HOST");
const booksOrgId = required("ZOHO_BOOKS_ORG_ID");
const crmHost = required("ZOHO_API_HOST");
const booksToken = await accessToken("books");
const crmToken = await accessToken("crm");

type Row = Record<string, unknown>;
type Answer = { status: number; json: Row | null };

async function send(url: string, method: string, token: string): Promise<Answer> {
  const response = await fetch(url, { method, headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : (JSON.parse(text) as Row) };
}

/** One call to Books, in the owner's organisation: its status and its JSON, if any. */
function books(method: string, path: string): Promise<Answer> {
  const separator = path.includes("?") ? "&" : "?";
  return send(`https://${booksHost}/books/v3${path}${separator}organization_id=${booksOrgId}`, method, booksToken);
}

/** Every record of a Books list, a page of 200 at a time, under the answer's `key`. */
async function booksRows(path: string, key: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await books("GET", `${path}?page=${String(page)}&per_page=200`);
    if (answer.status !== 200) throw new Error(`Books ${path} answered ${String(answer.status)}`);
    rows.push(...((answer.json?.[key] as Row[] | undefined) ?? []));
    if ((answer.json?.page_context as { has_more_page?: boolean } | undefined)?.has_more_page !== true) return rows;
  }
}

/**
 * Every CRM lead, a page of 200 at a time, by name; the CRM answers 204 for none. Null when the scripts' token may not
 * read leads.
 */
async function crmLeads(): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let page = 1; ; page += 1) {
    const path = `/crm/v8/Leads?fields=Full_Name&page=${String(page)}&per_page=200`;
    const answer = await send(`https://${crmHost}${path}`, "GET", crmToken);
    if (answer.status === 204) return rows;
    if (answer.json?.code === "OAUTH_SCOPE_MISMATCH") return null;
    if (answer.status !== 200) throw new Error(`the CRM's Leads answered ${String(answer.status)}`);
    rows.push(...((answer.json?.data as Row[] | undefined) ?? []));
    if ((answer.json?.info as { more_records?: boolean } | undefined)?.more_records !== true) return rows;
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const idOf = (row: Row, key: string): string => text(row[key]);

/**
 * What Books holds of staging's now, the CRM's leads of staging's (null where they could not be read), and the
 * look-alikes beside them.
 */
async function stagingRecords(): Promise<{ records: StagingRecord[]; leads: string[] | null; lookAlikes: string[] }> {
  const records: StagingRecord[] = [];
  const lookAlikes: string[] = [];
  const add = (kind: RecordKind, id: string, name: string, parentId?: string) => {
    records.push({ kind, id, name, ...(parentId === undefined ? {} : { parentId }) });
  };
  const judge = (kind: RecordKind, id: string, name: string, marked: boolean) => {
    if (marked) add(kind, id, name);
    else if (looksLikeATest(name)) lookAlikes.push(`${kind} ${id} "${name}"`);
  };

  for (const row of await booksRows("/customerpayments", "customerpayments")) {
    const paymentId = idOf(row, "payment_id");
    const description = text(row.description);
    judge("books/customerpayments", paymentId, description, isStagingLabelled(description));
    if (!isStagingLabelled(description)) continue;
    const refunds = await books("GET", `/customerpayments/${paymentId}/refunds`);
    for (const refund of (refunds.json?.payment_refunds as Row[] | undefined) ?? []) {
      add("books/refunds", idOf(refund, "payment_refund_id"), `a refund of payment ${paymentId}`, paymentId);
    }
  }
  for (const row of await booksRows("/invoices", "invoices")) {
    const name = `${text(row.invoice_number)} for ${text(row.customer_name)}`;
    judge("books/invoices", idOf(row, "invoice_id"), name, isStagingMarked(text(row.customer_name)));
  }
  for (const row of await booksRows("/contacts", "contacts")) {
    const name = text(row.contact_name);
    judge("books/contacts", idOf(row, "contact_id"), name, isStagingMarked(name));
  }

  const rows = await crmLeads();
  if (rows === null) return { records, leads: null, lookAlikes };
  const leads: string[] = [];
  for (const row of rows) {
    const name = text(row.Full_Name);
    if (isStagingMarked(name)) leads.push(`${idOf(row, "id")} ${name}`);
    else if (looksLikeATest(name)) lookAlikes.push(`crm/Leads ${idOf(row, "id")} "${name}"`);
  }
  return { records, leads, lookAlikes };
}

/** The path a record is deleted at. */
function pathOf(record: StagingRecord): string {
  if (record.kind === "books/refunds") return `/customerpayments/${record.parentId ?? ""}/refunds/${record.id}`;
  return `/${record.kind.slice("books/".length)}/${record.id}`;
}

/** Deletes one record, and says how it went in words for the owner. */
async function deleteOne(record: StagingRecord): Promise<string> {
  const answer = await books("DELETE", pathOf(record));
  if (answer.status === 404) return "already gone";
  if (answer.status >= 200 && answer.status < 300) return "deleted";
  return `refused: ${String(answer.status)} ${JSON.stringify(answer.json)}`;
}

const line = (record: StagingRecord) => `${record.kind.padEnd(24)} ${record.id.padEnd(20)} ${record.name}`;
const found = await stagingRecords();

if (values.delete === undefined) {
  const listed = `private/staging-records-${indiaDate(new Date())}.json`;
  mkdirSync("private", { recursive: true });
  writeFileSync(listed, `${JSON.stringify({ records: found.records }, null, 2)}\n`);
  for (const record of found.records) console.log(line(record));
  console.log(`\n${String(found.records.length)} records staging wrote in Books, written to ${listed}.`);
  if (found.leads === null) {
    console.log(
      "\nThe CRM's leads could not be read: the scripts' CRM token lacks ZohoCRM.modules.leads.READ. In the CRM's " +
        'Leads screen, delete those named "Staging test" or "Load test".',
    );
  } else if (found.leads.length > 0) {
    console.log("\nThe CRM's leads staging wrote. Delete these in the CRM's Leads screen:");
    for (const lead of found.leads) console.log(`  ${lead}`);
  }
  if (found.lookAlikes.length > 0) {
    console.log("\nThese look like tests but carry neither of staging's marks, so they are left alone:");
    for (const lookAlike of found.lookAlikes) console.log(`  ${lookAlike}`);
  }
  console.log(`\nTake out of ${listed} any record to keep; then run again with --delete ${listed}.`);
} else {
  const reviewed = (JSON.parse(readFileSync(values.delete, "utf8")) as { records: StagingRecord[] }).records;
  for (const record of leftAlone(reviewed, found.records)) {
    console.log(`left alone, no longer marked or held: ${line(record)}`);
  }
  for (const record of toDelete(reviewed, found.records)) {
    console.log(`${(await deleteOne(record)).padEnd(14)} ${line(record)}`);
  }
}
