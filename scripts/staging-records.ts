// Lists every record staging wrote into the owner's real Zoho org, in FSM and Books, for the owner to review; a
// second run deletes the list the owner kept (docs/open-points.md, items 19 and 155; docs/runbook.md, "Staging's
// records in the org").
//
//   node --env-file=.env.fsm-scripts scripts/staging-records.ts                   lists, and writes the list
//   node --env-file=.env.fsm-scripts scripts/staging-records.ts --delete <file>   deletes what the list keeps
//
// The file holds ZOHO_FSM_CLIENT_ID, ZOHO_FSM_CLIENT_SECRET, ZOHO_FSM_SCRIPTS_REFRESH_TOKEN (the scripts' own:
// scripts/lib/zoho-script-token.ts), ZOHO_FSM_ACCOUNTS_HOST, ZOHO_FSM_API_HOST and ZOHO_BOOKS_ORG_ID. No secret is
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
import { refreshTokenForScript } from "./lib/zoho-script-token.ts";
import { indiaDate } from "../src/lib/india-time.ts";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: { delete: { type: "string" }, "use-worker-token": { type: "boolean", default: false } },
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

const token = await accessToken();

/** One call to FSM (/fsm/v1) or Books (/books/v3, in the owner's organisation): its status and its JSON, if any. */
async function call(method: string, path: string): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const url = path.startsWith("/books/")
    ? `https://${apiHost}${path}${path.includes("?") ? "&" : "?"}organization_id=${booksOrgId}`
    : `https://${apiHost}${path}`;
  const response = await fetch(url, { method, headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : (JSON.parse(text) as Record<string, unknown>) };
}

type Row = Record<string, unknown>;

/** Every record of an FSM module, a page of 200 at a time; FSM answers 204 for none. */
async function fsmRows(module: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await call("GET", `/fsm/v1/${module}?page=${String(page)}&per_page=200`);
    if (answer.status === 204) return rows;
    if (answer.status !== 200) throw new Error(`FSM ${module} answered ${String(answer.status)}`);
    rows.push(...((answer.json?.data as Row[] | undefined) ?? []));
    if ((answer.json?.info as { more_records?: boolean } | undefined)?.more_records !== true) return rows;
  }
}

/** Every record of a Books list, a page of 200 at a time, under the answer's `key`. */
async function booksRows(path: string, key: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await call("GET", `/books/v3${path}?page=${String(page)}&per_page=200`);
    if (answer.status !== 200) throw new Error(`Books ${path} answered ${String(answer.status)}`);
    rows.push(...((answer.json?.[key] as Row[] | undefined) ?? []));
    if ((answer.json?.page_context as { has_more_page?: boolean } | undefined)?.has_more_page !== true) return rows;
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const idOf = (row: Row, key = "id"): string => text(row[key]);

/**
 * What the org holds of staging's now; the look-alikes it holds beside them; and FSM's invoices of staging's work
 * orders, or of none, which only FSM's own screen deletes.
 */
async function stagingRecords(): Promise<{ records: StagingRecord[]; lookAlikes: string[]; byHand: string[] }> {
  const records: StagingRecord[] = [];
  const lookAlikes: string[] = [];
  const byHand: string[] = [];
  const add = (kind: RecordKind, id: string, name: string, parentId?: string) => {
    records.push({ kind, id, name, ...(parentId === undefined ? {} : { parentId }) });
  };
  const judge = (kind: RecordKind, id: string, name: string, marked: boolean) => {
    if (marked) add(kind, id, name);
    else if (looksLikeATest(name)) lookAlikes.push(`${kind} ${id} "${name}"`);
  };

  for (const module of ["Service_Appointments", "Work_Orders", "Requests"] as const) {
    for (const row of await fsmRows(module)) {
      judge(`fsm/${module}`, idOf(row), text(row.Summary), isStagingLabelled(text(row.Summary)));
    }
  }
  const workOrders = new Set(records.filter((record) => record.kind === "fsm/Work_Orders").map((record) => record.id));
  for (const row of await fsmRows("Invoices")) {
    const workOrder = (row.Work_Order as { id?: string } | null | undefined)?.id;
    if (workOrder === undefined) byHand.push(`${idOf(row)} ${text(row.Name)}, of no work order`);
    else if (workOrders.has(workOrder)) byHand.push(`${idOf(row)} ${text(row.Name)}, of a staging work order`);
  }
  for (const row of await fsmRows("Contacts")) {
    judge("fsm/Contacts", idOf(row), text(row.Full_Name), isStagingMarked(text(row.Full_Name)));
  }

  const payments = await booksRows("/customerpayments", "customerpayments");
  for (const row of payments) {
    const paymentId = idOf(row, "payment_id");
    const description = text(row.description);
    judge("books/customerpayments", paymentId, description, isStagingLabelled(description));
    if (!isStagingLabelled(description)) continue;
    const refunds = await call("GET", `/books/v3/customerpayments/${paymentId}/refunds`);
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
  return { records, lookAlikes, byHand };
}

/** The path a record is deleted at. */
function pathOf(record: StagingRecord): string {
  const [place, module] = record.kind.split("/") as ["fsm" | "books", string];
  if (record.kind === "books/refunds") {
    return `/books/v3/customerpayments/${record.parentId ?? ""}/refunds/${record.id}`;
  }
  return place === "fsm" ? `/fsm/v1/${module}/${record.id}` : `/books/v3/${module}/${record.id}`;
}

/** Deletes one record, and says how it went in words for the owner. */
async function deleteOne(record: StagingRecord): Promise<string> {
  const answer = await call("DELETE", pathOf(record));
  if (answer.status === 404) return "already gone";
  // FSM answers 200 naming, under invalid_records, what it would not delete and why.
  const refused = (answer.json?.restricted_to_delete as { invalid_records?: Record<string, unknown> } | undefined)
    ?.invalid_records;
  if (refused !== undefined && Object.keys(refused).length > 0) return `refused: ${JSON.stringify(refused)}`;
  if (answer.status >= 200 && answer.status < 300) return "deleted";
  return `refused: ${String(answer.status)} ${JSON.stringify(answer.json)}`;
}

const line = (record: StagingRecord) => `${record.kind.padEnd(26)} ${record.id.padEnd(20)} ${record.name}`;
const found = await stagingRecords();

if (values.delete === undefined) {
  const listed = `private/staging-records-${indiaDate(new Date())}.json`;
  mkdirSync("private", { recursive: true });
  writeFileSync(listed, `${JSON.stringify({ records: found.records }, null, 2)}\n`);
  for (const record of found.records) console.log(line(record));
  console.log(`\n${String(found.records.length)} records staging wrote, written to ${listed}.`);
  if (found.byHand.length > 0) {
    console.log("\nFSM's API deletes no invoice. Delete these in FSM's Invoices screen, after the run below:");
    for (const invoice of found.byHand) console.log(`  ${invoice}`);
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
