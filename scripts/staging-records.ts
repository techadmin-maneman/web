// Lists every record staging wrote into the owner's real Zoho org, in Books, the CRM and, when its file is given, FSM,
// for the owner to review; a second run deletes what the list keeps, and clears staging's database's links to what is
// gone (docs/runbook.md, "Staging's records in the org").
//
//   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/staging-records.ts                  lists
//   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/staging-records.ts --delete <file>   deletes
//
// Add --env-file=.env.fsm-scripts to take in FSM's records as well. The files hold each client's ID, secret and hosts,
// ZOHO_BOOKS_ORG_ID, and the scripts' own refresh tokens (scripts/lib/zoho-script-token.ts). Staging's database is read
// and written with wrangler. No secret is printed. Nothing is deleted without --delete, and then only a record the
// owner's list keeps that the org and staging's database, read again, still hold as staging's.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  crmDeleteOutcome,
  crmHoldsNoSuchRecord,
  crmScopeMissing,
  isStagingLabelled,
  isStagingMarked,
  KNOWN_IDS_SQL,
  leftAlone,
  looksLikeATest,
  toDelete,
  unlinkStatements,
  unlisted,
  type KnownId,
  type Outcome,
  type RecordKind,
  type StagingRecord,
} from "./lib/staging-records.ts";
import { queryStaging, runOnStaging } from "./lib/staging-database.ts";
import { refreshTokenForScript, type ZohoClient } from "./lib/zoho-script-token.ts";
import { indiaDate } from "../src/lib/india-time.ts";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: { delete: { type: "string" }, "use-worker-token": { type: "boolean", default: false } },
});

function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function required(name: string): string {
  const value = optional(name);
  if (value === "") {
    console.error(`${name} is not set; pass the secrets files with --env-file`);
    process.exit(2);
  }
  return value;
}

/** What each client's variables start with: its ID, secret and hosts. */
const PREFIXES: Readonly<Record<ZohoClient, string>> = { books: "ZOHO_BOOKS_", crm: "ZOHO_", fsm: "ZOHO_FSM_" };

async function accessToken(client: ZohoClient): Promise<string> {
  const prefix = PREFIXES[client];
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

const readsFsm = optional("ZOHO_FSM_API_HOST") !== "";
const booksHost = required("ZOHO_BOOKS_API_HOST");
const booksOrgId = required("ZOHO_BOOKS_ORG_ID");
const crmHost = required("ZOHO_API_HOST");
const booksToken = await accessToken("books");
const crmToken = await accessToken("crm");
const fsmToken = readsFsm ? await accessToken("fsm") : "";

type Row = Record<string, unknown>;

interface Answer {
  readonly status: number;
  readonly json: Row | null;
}

async function send(method: string, url: string, token: string): Promise<Answer> {
  const response = await fetch(url, { method, headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const body = await response.text();
  return { status: response.status, json: body === "" ? null : (JSON.parse(body) as Row) };
}

/** One call to Books, in the owner's organisation. */
function books(method: string, path: string): Promise<Answer> {
  const separator = path.includes("?") ? "&" : "?";
  return send(method, `https://${booksHost}/books/v3${path}${separator}organization_id=${booksOrgId}`, booksToken);
}

function crm(method: string, path: string): Promise<Answer> {
  return send(method, `https://${crmHost}/crm/v8${path}`, crmToken);
}

function fsm(method: string, path: string): Promise<Answer> {
  return send(method, `https://${required("ZOHO_FSM_API_HOST")}/fsm/v1${path}`, fsmToken);
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
 * Every record of a CRM module by name, a page of 200 at a time; the CRM answers 204 for none. Null when the scripts'
 * token may not read the module.
 */
async function crmRows(module: "Leads" | "Contacts"): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await crm("GET", `/${module}?fields=Full_Name&page=${String(page)}&per_page=200`);
    if (answer.status === 204) return rows;
    if (crmScopeMissing(answer.json)) return null;
    if (answer.status !== 200) throw new Error(`the CRM's ${module} answered ${String(answer.status)}`);
    rows.push(...((answer.json?.data as Row[] | undefined) ?? []));
    if ((answer.json?.info as { more_records?: boolean } | undefined)?.more_records !== true) return rows;
  }
}

/** Every record of an FSM module, a page of 200 at a time; FSM answers 204 for none. */
async function fsmRows(module: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await fsm("GET", `/${module}?page=${String(page)}&per_page=200`);
    if (answer.status === 204) return rows;
    if (answer.status !== 200) throw new Error(`FSM ${module} answered ${String(answer.status)}`);
    rows.push(...((answer.json?.data as Row[] | undefined) ?? []));
    if ((answer.json?.info as { more_records?: boolean } | undefined)?.more_records !== true) return rows;
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const idOf = (row: Row, key: string): string => text(row[key]);

interface Found {
  readonly records: StagingRecord[];
  /** Records that look like tests but carry neither mark: shown, never deleted. */
  readonly lookAlikes: string[];
  /** FSM's invoices of staging's work orders, which only FSM's own screen deletes. */
  readonly byHand: string[];
  /** IDs staging's database keeps of records the org no longer holds. */
  readonly gone: KnownId[];
  /** The CRM modules the scripts' CRM token may not read. */
  readonly unreadable: string[];
}

function add(found: Found, kind: RecordKind, id: string, name: string, parentId?: string): void {
  found.records.push({ kind, id, name, ...(parentId === undefined ? {} : { parentId }) });
}

function judge(found: Found, kind: RecordKind, id: string, name: string, marked: boolean): void {
  if (marked) add(found, kind, id, name);
  else if (looksLikeATest(name)) found.lookAlikes.push(`${kind} ${id} "${name}"`);
}

async function readBooks(found: Found): Promise<void> {
  for (const row of await booksRows("/customerpayments", "customerpayments")) {
    const description = text(row.description);
    judge(found, "books/customerpayments", idOf(row, "payment_id"), description, isStagingLabelled(description));
  }
  for (const row of await booksRows("/invoices", "invoices")) {
    const name = `${text(row.invoice_number)} for ${text(row.customer_name)}`;
    judge(found, "books/invoices", idOf(row, "invoice_id"), name, isStagingMarked(text(row.customer_name)));
  }
  for (const row of await booksRows("/contacts", "contacts")) {
    const name = text(row.contact_name);
    judge(found, "books/contacts", idOf(row, "contact_id"), name, isStagingMarked(name));
  }
}

async function readCrm(found: Found): Promise<void> {
  for (const module of ["Leads", "Contacts"] as const) {
    const rows = await crmRows(module);
    if (rows === null) {
      found.unreadable.push(module);
      continue;
    }
    for (const row of rows) {
      const name = text(row.Full_Name);
      judge(found, `crm/${module}`, idOf(row, "id"), name, isStagingMarked(name));
    }
  }
}

/** FSM's records of staging's. FSM's invoices of staging's work orders are listed apart: its API deletes none. */
async function readFsm(found: Found): Promise<void> {
  for (const module of ["Service_Appointments", "Work_Orders", "Requests"] as const) {
    for (const row of await fsmRows(module)) {
      const summary = text(row.Summary);
      judge(found, `fsm/${module}`, idOf(row, "id"), summary, isStagingLabelled(summary));
    }
  }
  const workOrders = new Set(
    found.records.filter((record) => record.kind === "fsm/Work_Orders").map((record) => record.id),
  );
  for (const row of await fsmRows("Invoices")) {
    const workOrder = (row.Work_Order as { id?: string } | null | undefined)?.id;
    if (workOrder !== undefined && workOrders.has(workOrder)) {
      found.byHand.push(`${idOf(row, "id")} ${text(row.Name)}, of a staging work order`);
    }
  }
  for (const row of await fsmRows("Contacts")) {
    const name = text(row.Full_Name);
    judge(found, "fsm/Contacts", idOf(row, "id"), name, isStagingMarked(name));
  }
}

/** Where Books keeps each kind of record staging's database knows by ID, and how the owner knows it. */
const BOOKS_READS = {
  "books/contacts": { path: "/contacts", key: "contact", name: (row: Row) => text(row.contact_name) },
  "books/customerpayments": {
    path: "/customerpayments",
    key: "payment",
    name: (row: Row) => `${text(row.payment_number)} from ${text(row.customer_name)}`,
  },
  "books/invoices": {
    path: "/invoices",
    key: "invoice",
    name: (row: Row) => `${text(row.invoice_number)} for ${text(row.customer_name)}`,
  },
} as const;

/** The Books record's name, or null once Books holds it no more. */
async function booksName(kind: keyof typeof BOOKS_READS, id: string): Promise<string | null> {
  const read = BOOKS_READS[kind];
  const answer = await books("GET", `${read.path}/${id}`);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`Books ${read.path}/${id} answered ${String(answer.status)}`);
  return read.name((answer.json?.[read.key] as Row | undefined) ?? {});
}

/** The CRM lead's name, or null once the CRM holds it no more. */
async function leadName(id: string): Promise<string | null> {
  const answer = await crm("GET", `/Leads/${id}`);
  if (crmHoldsNoSuchRecord(answer.status, answer.json)) return null;
  if (answer.status !== 200) throw new Error(`the CRM's lead ${id} answered ${String(answer.status)}`);
  const [lead] = (answer.json?.data as Row[] | undefined) ?? [];
  return text(lead?.Full_Name);
}

/**
 * Each ID staging's database keeps that the marks did not find, read by itself, so an erased or inactive record is
 * listed too. One the org no longer holds is noted, for its link to be cleared.
 */
async function readKnown(found: Found): Promise<void> {
  for (const known of unlisted(queryStaging<KnownId>(KNOWN_IDS_SQL), found.records)) {
    if (known.kind === "crm/Leads" && found.unreadable.includes("Leads")) continue;
    const name = known.kind === "crm/Leads" ? await leadName(known.id) : await booksName(known.kind, known.id);
    if (name === null) found.gone.push(known);
    else add(found, known.kind, known.id, `${name} (in staging's database)`);
  }
}

/** The refunds of every staging payment listed, which go before their payment. */
async function readRefunds(found: Found): Promise<void> {
  const payments = found.records.filter((record) => record.kind === "books/customerpayments");
  for (const payment of payments) {
    const answer = await books("GET", `/customerpayments/${payment.id}/refunds`);
    for (const refund of (answer.json?.payment_refunds as Row[] | undefined) ?? []) {
      add(found, "books/refunds", idOf(refund, "payment_refund_id"), `a refund of payment ${payment.id}`, payment.id);
    }
  }
}

async function stagingRecords(): Promise<Found> {
  const found: Found = { records: [], lookAlikes: [], byHand: [], gone: [], unreadable: [] };
  if (readsFsm) await readFsm(found);
  await readBooks(found);
  await readCrm(found);
  await readKnown(found);
  await readRefunds(found);
  return found;
}

function booksPath(record: StagingRecord): string {
  if (record.kind === "books/refunds") return `/customerpayments/${record.parentId ?? ""}/refunds/${record.id}`;
  return `/${record.kind.slice("books/".length)}/${record.id}`;
}

async function deleteFromBooks(record: StagingRecord): Promise<Outcome> {
  const answer = await books("DELETE", booksPath(record));
  if (answer.status === 404) return "already gone";
  if (answer.status >= 200 && answer.status < 300) return "deleted";
  return `refused: ${String(answer.status)} ${JSON.stringify(answer.json)}`;
}

async function deleteFromCrm(record: StagingRecord): Promise<Outcome> {
  const answer = await crm("DELETE", `/${record.kind.slice("crm/".length)}/${record.id}?wf_trigger=false`);
  return crmDeleteOutcome(answer.status, answer.json);
}

async function deleteFromFsm(record: StagingRecord): Promise<Outcome> {
  const answer = await fsm("DELETE", `/${record.kind.slice("fsm/".length)}/${record.id}`);
  if (answer.status === 404) return "already gone";
  // FSM answers 200 naming, under invalid_records, what it would not delete and why.
  const refused = (answer.json?.restricted_to_delete as { invalid_records?: Row } | undefined)?.invalid_records;
  if (refused !== undefined && Object.keys(refused).length > 0) return `refused: ${JSON.stringify(refused)}`;
  if (answer.status >= 200 && answer.status < 300) return "deleted";
  return `refused: ${String(answer.status)} ${JSON.stringify(answer.json)}`;
}

function deleteOne(record: StagingRecord): Promise<Outcome> {
  if (record.kind.startsWith("crm/")) return deleteFromCrm(record);
  if (record.kind.startsWith("fsm/")) return deleteFromFsm(record);
  return deleteFromBooks(record);
}

const line = (record: StagingRecord) => `${record.kind.padEnd(26)} ${record.id.padEnd(20)} ${record.name}`;

function printList(found: Found): void {
  const listed = `private/staging-records-${indiaDate(new Date())}.json`;
  mkdirSync("private", { recursive: true });
  writeFileSync(listed, `${JSON.stringify({ records: found.records }, null, 2)}\n`);
  for (const record of found.records) console.log(line(record));
  console.log(`\n${String(found.records.length)} records staging wrote, written to ${listed}.`);
  if (!readsFsm) console.log("FSM was not read: add --env-file=.env.fsm-scripts to take in its records.");
  for (const module of found.unreadable) {
    console.log(
      `\nThe CRM's ${module} could not be read: the scripts' CRM token lacks ` +
        `ZohoCRM.modules.${module.toLowerCase()}.READ (runbook, step 8.7). Until it has it, delete those named ` +
        `"Staging test" or "Load test" in the CRM's ${module} screen.`,
    );
  }
  if (found.byHand.length > 0) {
    console.log("\nFSM's API deletes no invoice. Delete these in FSM's Invoices screen, after the run below:");
    for (const invoice of found.byHand) console.log(`  ${invoice}`);
  }
  if (found.gone.length > 0) {
    console.log(
      "\nStaging's database keeps these IDs of records the org no longer holds. The run below clears a client's " +
        "customer and lead and a visit's invoice; a payment's ID stays:",
    );
    for (const known of found.gone) console.log(`  ${known.kind} ${known.id}`);
  }
  if (found.lookAlikes.length > 0) {
    console.log("\nThese look like tests but carry neither of staging's marks, so they are left alone:");
    for (const lookAlike of found.lookAlikes) console.log(`  ${lookAlike}`);
  }
  console.log(`\nTake out of ${listed} any record to keep; then run again with --delete ${listed}.`);
}

async function deleteReviewed(file: string, found: Found): Promise<void> {
  const reviewed = (JSON.parse(readFileSync(file, "utf8")) as { records: StagingRecord[] }).records;
  for (const record of leftAlone(reviewed, found.records)) {
    console.log(`left alone, no longer staging's or held: ${line(record)}`);
  }
  const gone: { kind: RecordKind; id: string }[] = [...found.gone];
  for (const record of toDelete(reviewed, found.records)) {
    const outcome = await deleteOne(record);
    console.log(`${outcome.padEnd(14)} ${line(record)}`);
    if (outcome === "deleted" || outcome === "already gone") gone.push(record);
  }
  const statements = unlinkStatements(gone);
  if (statements.length === 0) return;
  runOnStaging(statements);
  console.log("\nStaging's database no longer points at the customers, invoices and leads now gone.");
}

const found = await stagingRecords();
if (values.delete === undefined) printList(found);
else await deleteReviewed(values.delete, found);
