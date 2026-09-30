// Staging's records in the owner's real Zoho org (docs/open-points.md, items 19 and 155): which of FSM's and
// Books' records staging wrote, and the order a reviewed list of them is deleted in. scripts/staging-records.ts reads
// the org and deletes; this decides, and reaches nothing.
//
// Staging marks what it writes in two ways. A summary, a note or a description starts with "Staging test: "
// (src/domain/bookings.ts, src/domain/books-sync.ts). A person our scripts invent is named "Staging test" or
// "Load test" (src/policy/staging-test-records.ts), and FSM gives Books a contact of the same name.

import { isStagingTestRecord } from "../../src/policy/staging-test-records.ts";

/** Where a record is, and its module there, in the order a list is deleted in: what points at a record goes first. */
export const DELETE_ORDER = [
  "books/refunds",
  "books/customerpayments",
  "fsm/Service_Appointments",
  "fsm/Invoices",
  "books/invoices",
  "fsm/Work_Orders",
  "fsm/Requests",
  "fsm/Contacts",
  "books/contacts",
] as const;

export type RecordKind = (typeof DELETE_ORDER)[number];

export interface StagingRecord {
  readonly kind: RecordKind;
  readonly id: string;
  /** What the owner reads to know it: its summary, name or description. */
  readonly name: string;
  /** A Books refund's payment, which its path names. */
  readonly parentId?: string;
}

/** What staging writes before a summary, a note or a description, and what the load test would. */
const LABELS = ["Staging test: ", "Load test: "] as const;

/** Whether this summary, note or description is one staging wrote. */
export function isStagingLabelled(text: string | null | undefined): boolean {
  return LABELS.some((label) => (text ?? "").startsWith(label));
}

/** Whether a name or summary is staging's by either mark. */
export function isStagingMarked(text: string | null | undefined): boolean {
  return isStagingLabelled(text) || isStagingTestRecord(text ?? "");
}

/**
 * A name that looks like a test but carries neither mark, as "Staging Test Client": shown to the owner, never
 * deleted, since nothing of ours wrote it.
 */
export function looksLikeATest(text: string | null | undefined): boolean {
  return !isStagingMarked(text) && /\b(staging|load) test\b/i.test(text ?? "");
}

/**
 * The records to delete: those the owner kept in the reviewed list that the org, read again now, still holds and
 * still marks as staging's, in the order they are deleted in. A record the list names and the org no longer marks,
 * or holds no more, is left alone.
 */
export function toDelete(reviewed: readonly StagingRecord[], foundNow: readonly StagingRecord[]): StagingRecord[] {
  const found = new Set(foundNow.map((record) => `${record.kind} ${record.id}`));
  return reviewed
    .filter((record) => found.has(`${record.kind} ${record.id}`))
    .sort((a, b) => DELETE_ORDER.indexOf(a.kind) - DELETE_ORDER.indexOf(b.kind));
}

/** The records the reviewed list names that the org no longer marks as staging's, or no longer holds. */
export function leftAlone(reviewed: readonly StagingRecord[], foundNow: readonly StagingRecord[]): StagingRecord[] {
  const kept = new Set(toDelete(reviewed, foundNow).map((record) => `${record.kind} ${record.id}`));
  return reviewed.filter((record) => !kept.has(`${record.kind} ${record.id}`));
}
