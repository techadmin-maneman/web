// Staging's records in the owner's real Zoho org: which of Books' and the CRM's records staging wrote, the order a
// reviewed list of them is deleted in, and the links staging's database keeps to them. scripts/staging-records.ts
// reads the org and deletes; this decides, and reaches nothing.
//
// Staging marks what it writes in two ways. A note or a description starts with "Staging test: "
// (src/domain/books-sync.ts). A person our scripts invent is named "Staging test" or "Load test"
// (src/policy/staging-test-records.ts), and their Books customer and CRM lead carry that name.
// Every ID staging's database keeps is staging's too, whatever the record is named now: an erased client's, say.

import { isStagingTestName } from "../../src/policy/staging-test-records.ts";

/** Where a record is, and its module there, in the order a list is deleted in: what points at a record goes first. */
export const DELETE_ORDER = [
  "books/refunds",
  "books/customerpayments",
  "books/invoices",
  "books/contacts",
  "crm/Contacts",
  "crm/Leads",
] as const;

export type RecordKind = (typeof DELETE_ORDER)[number];

export interface StagingRecord {
  readonly kind: RecordKind;
  readonly id: string;
  /** What the owner reads to know it: its name or description. */
  readonly name: string;
  /** A Books refund's payment, which its path names. */
  readonly parentId?: string;
}

/** An ID staging's database keeps, and where its record is. */
export interface KnownId {
  readonly kind: "books/contacts" | "books/customerpayments" | "books/invoices" | "crm/Leads";
  readonly id: string;
}

/** What staging writes before a note or a description, and what the load test would. */
const LABELS = ["Staging test: ", "Load test: "] as const;

/** Whether this note or description is one staging wrote. */
export function isStagingLabelled(text: string | null | undefined): boolean {
  return LABELS.some((label) => (text ?? "").startsWith(label));
}

/** Whether a name or description is staging's by either mark. */
export function isStagingMarked(text: string | null | undefined): boolean {
  return isStagingLabelled(text) || isStagingTestName(text ?? "");
}

/**
 * A name that looks like a test but carries neither mark, as "Staging Test Client": shown to the owner, never
 * deleted, since nothing of ours wrote it.
 */
export function looksLikeATest(text: string | null | undefined): boolean {
  return !isStagingMarked(text) && /\b(staging|load) test\b/i.test(text ?? "");
}

const keyOf = (record: { kind: string; id: string }) => `${record.kind} ${record.id}`;

/**
 * The records to delete: those the owner kept in the reviewed list that the org, read again now, still holds as
 * staging's, in the order they are deleted in. A record the list names that the org no longer holds as staging's is
 * left alone.
 */
export function toDelete(reviewed: readonly StagingRecord[], foundNow: readonly StagingRecord[]): StagingRecord[] {
  const found = new Set(foundNow.map(keyOf));
  return reviewed
    .filter((record) => found.has(keyOf(record)))
    .sort((a, b) => DELETE_ORDER.indexOf(a.kind) - DELETE_ORDER.indexOf(b.kind));
}

/** The records the reviewed list names that the org no longer holds as staging's. */
export function leftAlone(reviewed: readonly StagingRecord[], foundNow: readonly StagingRecord[]): StagingRecord[] {
  const kept = new Set(toDelete(reviewed, foundNow).map(keyOf));
  return reviewed.filter((record) => !kept.has(keyOf(record)));
}

/** The IDs staging's database keeps of records the name marks did not find, to be read one by one. */
export function unlisted(known: readonly KnownId[], found: readonly StagingRecord[]): KnownId[] {
  const listed = new Set(found.map(keyOf));
  return known.filter((each) => !listed.has(keyOf(each)));
}

/** Every Books and CRM ID staging's database keeps, with where its record is. */
export const KNOWN_IDS_SQL = [
  "SELECT 'books/contacts' AS kind, books_customer_id AS id FROM people WHERE books_customer_id IS NOT NULL",
  "UNION SELECT 'books/customerpayments', books_payment_id FROM payments WHERE books_payment_id IS NOT NULL",
  "UNION SELECT 'books/invoices', fsm_invoice_id FROM appointments WHERE fsm_invoice_id IS NOT NULL",
  "UNION SELECT 'crm/Leads', zoho_lead_id FROM people WHERE zoho_lead_id IS NOT NULL",
].join(" ");

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Where staging's database keeps each kind of ID it may let go of. A payment's and a refund's stay: cleared, the Books
 * pass would record staging's old payments again, without their refunds.
 */
const LINKS: readonly { readonly kind: RecordKind; readonly table: string; readonly column: string }[] = [
  { kind: "books/contacts", table: "people", column: "books_customer_id" },
  { kind: "books/invoices", table: "appointments", column: "fsm_invoice_id" },
  { kind: "crm/Leads", table: "people", column: "zoho_lead_id" },
];

/**
 * The statements that clear staging's database's links to records the org no longer holds, so that nothing follows
 * one to a customer, invoice or lead that is gone: the Books pass makes a new customer when the client next needs one.
 */
export function unlinkStatements(gone: readonly { kind: RecordKind; id: string }[]): string[] {
  const statements: string[] = [];
  for (const link of LINKS) {
    const ids = new Set(gone.filter((record) => record.kind === link.kind).map((record) => quote(record.id)));
    if (ids.size === 0) continue;
    const list = [...ids].join(", ");
    statements.push(`UPDATE ${link.table} SET ${link.column} = NULL WHERE ${link.column} IN (${list});`);
  }
  return statements;
}

/** How a delete went, in words for the owner. */
export type Outcome = "deleted" | "already gone" | `refused: ${string}`;

/** How the CRM answers for a record it does not hold: deleted, merged away or converted. */
const CRM_GONE_CODES: ReadonlySet<string> = new Set(["INVALID_DATA", "ENTITY_ID_INVALID", "RECORD_NOT_FOUND"]);

/** The CRM's code in an answer: at its top for the request, else on its one record. */
function crmCode(json: Record<string, unknown> | null): string | null {
  if (typeof json?.code === "string") return json.code;
  const [record] = (json?.data as { code?: unknown }[] | undefined) ?? [];
  return typeof record?.code === "string" ? record.code : null;
}

/** Whether the CRM answered that it does not hold the record asked for. */
export function crmHoldsNoSuchRecord(status: number, json: Record<string, unknown> | null): boolean {
  if (status === 204 || status === 404) return true;
  return CRM_GONE_CODES.has(crmCode(json) ?? "");
}

/** Whether the CRM refused because the scripts' token lacks the scope for it. */
export function crmScopeMissing(json: Record<string, unknown> | null): boolean {
  return crmCode(json) === "OAUTH_SCOPE_MISMATCH";
}

/** How the CRM's answer to DELETE /crm/v8/{module}/{id} went. */
export function crmDeleteOutcome(status: number, json: Record<string, unknown> | null): Outcome {
  if (crmScopeMissing(json)) {
    return "refused: the scripts' CRM token may not delete it (runbook, step 8.7); delete it in the CRM";
  }
  if (crmHoldsNoSuchRecord(status, json)) return "already gone";
  if (crmCode(json) === "SUCCESS") return "deleted";
  return `refused: ${String(status)} ${JSON.stringify(json)}`;
}
