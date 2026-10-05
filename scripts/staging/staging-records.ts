// Lists every record staging wrote into the owner's real Zoho org, in Books and the CRM, for the owner to review; a second run deletes what the list keeps, and clears staging's database's links to what is
// gone (docs/runbook.md, "Staging's records in the org").
//
//   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/staging/staging-records.ts                  lists
//   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/staging/staging-records.ts --delete <file>   deletes
//
// The files hold each client's ID, secret and hosts,
// ZOHO_BOOKS_ORG_ID, and the scripts' own refresh tokens (scripts/lib/zoho-script-token.ts). Staging's database is read
// and written with wrangler. No secret is printed. Nothing is deleted without --delete, and then only a record the
// owner's list keeps that the org and staging's database, read again, still hold as staging's.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { z } from "zod";
import {
  BOOKS_CONTACT,
  BOOKS_INVOICE,
  BOOKS_PAYMENT,
  BOOKS_REFUND,
  booksPage,
  booksRecord,
  CRM_RECORD,
  crmDeleteOutcome,
  crmHoldsNoSuchRecord,
  crmPage,
  crmScopeMissing,
  isStagingLabelled,
  isStagingMarked,
  KNOWN_IDS_SQL,
  leftAlone,
  looksLikeATest,
  REVIEWED_LIST,
  toDelete,
  unlinkStatements,
  unlisted,
  type KnownId,
  type Outcome,
  type RecordKind,
  type StagingRecord,
} from "../lib/staging-records.ts";
import { d1Execute, d1Query } from "../lib/d1.ts";
import { zohoScriptClient, type ZohoAnswer } from "../lib/zoho-script-client.ts";
import { indiaDate } from "../../src/lib/india-time.ts";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: { delete: { type: "string" }, "use-worker-token": { type: "boolean", default: false } },
});

const books = await zohoScriptClient("books");
const crm = await zohoScriptClient("crm");

/** One call to the CRM's records, below /crm/v8. */
const crmRecords = (method: string, path: string): Promise<ZohoAnswer> => crm.call(method, `/crm/v8${path}`);

/** Every record of a Books list, a page of 200 at a time, under the answer's `key`. */
async function booksRows<T>(path: string, key: string, row: z.ZodType<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let number = 1; ; number += 1) {
    const answer = await books.call("GET", `${path}?page=${String(number)}&per_page=200`);
    if (answer.status !== 200) throw new Error(`Books ${path} answered ${String(answer.status)}`);
    const page = booksPage(answer.json, key, row);
    rows.push(...page.rows);
    if (!page.more) return rows;
  }
}

/**
 * Every record of a CRM module by name, a page of 200 at a time; the CRM answers 204 for none. Null when the scripts'
 * token may not read the module.
 */
async function crmRows(module: "Leads" | "Contacts"): Promise<z.infer<typeof CRM_RECORD>[] | null> {
  const rows: z.infer<typeof CRM_RECORD>[] = [];
  for (let number = 1; ; number += 1) {
    const answer = await crmRecords("GET", `/${module}?fields=Full_Name&page=${String(number)}&per_page=200`);
    if (answer.status === 204) return rows;
    if (crmScopeMissing(answer.json)) return null;
    if (answer.status !== 200) throw new Error(`the CRM's ${module} answered ${String(answer.status)}`);
    const page = crmPage(answer.json);
    rows.push(...page.rows);
    if (!page.more) return rows;
  }
}

interface Found {
  readonly records: StagingRecord[];
  /** Records that look like tests but carry neither mark: shown, never deleted. */
  readonly lookAlikes: string[];
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
  for (const row of await booksRows("/customerpayments", "customerpayments", BOOKS_PAYMENT)) {
    judge(found, "books/customerpayments", row.payment_id, row.description, isStagingLabelled(row.description));
  }
  for (const row of await booksRows("/invoices", "invoices", BOOKS_INVOICE)) {
    const name = `${row.invoice_number} for ${row.customer_name}`;
    judge(found, "books/invoices", row.invoice_id, name, isStagingMarked(row.customer_name));
  }
  for (const row of await booksRows("/contacts", "contacts", BOOKS_CONTACT)) {
    judge(found, "books/contacts", row.contact_id, row.contact_name, isStagingMarked(row.contact_name));
  }
}

async function readCrm(found: Found): Promise<void> {
  for (const module of ["Leads", "Contacts"] as const) {
    const rows = await crmRows(module);
    if (rows === null) {
      found.unreadable.push(module);
      continue;
    }
    for (const row of rows) judge(found, `crm/${module}`, row.id, row.Full_Name, isStagingMarked(row.Full_Name));
  }
}

/** Where Books keeps each kind of record staging's database knows by ID, and how the owner knows it. */
const BOOKS_READS = {
  "books/contacts": {
    path: "/contacts",
    name: (json: unknown) => booksRecord(json, "contact", BOOKS_CONTACT).contact_name,
  },
  "books/customerpayments": {
    path: "/customerpayments",
    name: (json: unknown) => {
      const payment = booksRecord(json, "payment", BOOKS_PAYMENT);
      return `${payment.payment_number} from ${payment.customer_name}`;
    },
  },
  "books/invoices": {
    path: "/invoices",
    name: (json: unknown) => {
      const invoice = booksRecord(json, "invoice", BOOKS_INVOICE);
      return `${invoice.invoice_number} for ${invoice.customer_name}`;
    },
  },
} as const;

/** The Books record's name, or null once Books holds it no more. */
async function booksName(kind: keyof typeof BOOKS_READS, id: string): Promise<string | null> {
  const read = BOOKS_READS[kind];
  const answer = await books.call("GET", `${read.path}/${id}`);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`Books ${read.path}/${id} answered ${String(answer.status)}`);
  return read.name(answer.json);
}

/** The CRM lead's name, or null once the CRM holds it no more. */
async function leadName(id: string): Promise<string | null> {
  const answer = await crmRecords("GET", `/Leads/${id}`);
  if (crmHoldsNoSuchRecord(answer.status, answer.json)) return null;
  if (answer.status !== 200) throw new Error(`the CRM's lead ${id} answered ${String(answer.status)}`);
  const [lead] = crmPage(answer.json).rows;
  return lead?.Full_Name ?? "";
}

/**
 * Each ID staging's database keeps that the marks did not find, read by itself, so an erased or inactive record is
 * listed too. One the org no longer holds is noted, for its link to be cleared.
 */
async function readKnown(found: Found): Promise<void> {
  for (const known of unlisted(d1Query<KnownId>("staging", KNOWN_IDS_SQL), found.records)) {
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
    const answer = await books.call("GET", `/customerpayments/${payment.id}/refunds`);
    for (const refund of booksPage(answer.json, "payment_refunds", BOOKS_REFUND).rows) {
      add(found, "books/refunds", refund.payment_refund_id, `a refund of payment ${payment.id}`, payment.id);
    }
  }
}

async function stagingRecords(): Promise<Found> {
  const found: Found = { records: [], lookAlikes: [], gone: [], unreadable: [] };
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
  const answer = await books.call("DELETE", booksPath(record));
  if (answer.status === 404) return "already gone";
  if (answer.status >= 200 && answer.status < 300) return "deleted";
  return `refused: ${String(answer.status)} ${JSON.stringify(answer.json)}`;
}

async function deleteFromCrm(record: StagingRecord): Promise<Outcome> {
  const answer = await crmRecords("DELETE", `/${record.kind.slice("crm/".length)}/${record.id}?wf_trigger=false`);
  return crmDeleteOutcome(answer.status, answer.json);
}

function deleteOne(record: StagingRecord): Promise<Outcome> {
  if (record.kind.startsWith("crm/")) return deleteFromCrm(record);
  return deleteFromBooks(record);
}

const line = (record: StagingRecord) => `${record.kind.padEnd(26)} ${record.id.padEnd(20)} ${record.name}`;

function printList(found: Found): void {
  const listed = `private/staging-records-${indiaDate(new Date())}.json`;
  mkdirSync("private", { recursive: true });
  writeFileSync(listed, `${JSON.stringify({ records: found.records }, null, 2)}\n`);
  for (const record of found.records) console.log(line(record));
  console.log(`\n${String(found.records.length)} records staging wrote, written to ${listed}.`);
  for (const module of found.unreadable) {
    console.log(
      `\nThe CRM's ${module} could not be read: the scripts' CRM token lacks ` +
        `ZohoCRM.modules.${module.toLowerCase()}.READ (runbook, step 8.7). Until it has it, delete those named ` +
        `"Staging test" or "Load test" in the CRM's ${module} screen.`,
    );
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
  const { records: reviewed } = REVIEWED_LIST.parse(JSON.parse(readFileSync(file, "utf8")));
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
  d1Execute("staging", statements);
  console.log("\nStaging's database no longer points at the customers, invoices and leads now gone.");
}

const found = await stagingRecords();
if (values.delete === undefined) printList(found);
else await deleteReviewed(values.delete, found);
