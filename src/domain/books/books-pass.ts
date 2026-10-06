// One pass of the Books sync (./books-sync.ts): what it carries, each record claimed before Books is asked, and a
// failure told to ops at once if refused, else once it has happened three times.

import type { GstRegistration } from "../../config/gst.ts";
import { failureReason, type Logger } from "../../log.ts";
import type { BooksProvider } from "../../providers/books/index.ts";
import { paymentsTab, type AlertOnce, type ResolveAlert } from "../ops/alerts.ts";
import { tellFailure as tellPassFailure, FAILURES_BEFORE_ALERT } from "./vendor-pass.ts";

export interface BooksSyncOptions {
  readonly refundAccountId: string | null;
  readonly labelAsTest: boolean;
  readonly gst: GstRegistration;
}

export interface BooksSyncDeps {
  readonly books: BooksProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
}

const describe = (error: unknown): string => failureReason(error, 200);
export interface Pass {
  readonly db: D1Database;
  readonly deps: BooksSyncDeps;
  readonly options: BooksSyncOptions;
  readonly log: Logger;
  /** Now, as stored. */
  readonly at: string;
  /** A record last tried before this is tried again. */
  readonly recheck: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// What every step shares
// ---------------------------------------------------------------------------
/** A record Books failed on, in the words its alert uses. */
interface FailedRecord {
  readonly kind: "customer" | "customer_update" | "payment" | "apply" | "refund";
  readonly id: string;
  readonly personId: string;
  /** "payment <id> (Razorpay <id>)", or what Books was asked to do with it. */
  readonly what: string;
  /** What happens next, or what ops must do. */
  readonly then: string;
}

/** The field of the log line that names the record. */
const ID_FIELDS: Readonly<Record<FailedRecord["kind"], string>> = {
  customer: "person_id",
  customer_update: "person_id",
  payment: "payment_id",
  apply: "payment_id",
  refund: "refund_id",
};

/** Where ops act on it: the client's page for their customer in Books, their Payments tab for their money. */
function linkOf(record: FailedRecord): string {
  const aboutTheCustomer = record.kind === "customer" || record.kind === "customer_update";
  return aboutTheCustomer ? `/clients/${record.personId}` : paymentsTab(record.personId);
}

/** Tells ops a record did not reach Books: Books' refusal at once, any other failure on its third time. */
export const tellFailure = (pass: Pass, record: FailedRecord, error: unknown): Promise<void> =>
  tellPassFailure(
    pass,
    {
      event: `books_${record.kind}`,
      id: record.id,
      idField: ID_FIELDS[record.kind],
      link: linkOf(record),
      // Books' own words; its status and code go to the log.
      refused: (said) => `Books refused ${record.what}, saying "${said}". ${record.then}`,
      failed: (failure) =>
        `Books has failed ${String(FAILURES_BEFORE_ALERT)} times on ${record.what}: ${describe(failure)}. ${record.then}`,
    },
    error,
  );
/** Once a record goes through, whatever was told about it is over. */
export async function closeFailures(pass: Pass, record: FailedRecord): Promise<void> {
  await pass.deps.resolveAlert(`books_${record.kind}_refused:${record.id}`);
  await pass.deps.resolveAlert(`books_${record.kind}_failed:${record.id}`);
}

/**
 * Takes the payment for this pass, marking it tried now, so an overlapping run leaves it and a failure waits an hour;
 * false where another run took it first, or has recorded it since.
 */
export async function claimToRecord(pass: Pass, paymentId: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE payments SET books_checked_at = ?1
       WHERE id = ?2 AND books_payment_id IS NULL AND (books_checked_at IS NULL OR books_checked_at < ?3)
       RETURNING id`,
    )
    .bind(pass.at, paymentId, pass.recheck)
    .first();
  return claimed !== null;
}

/** As claimToRecord, for setting the payment against its invoice. */
export async function claimToApply(pass: Pass, paymentId: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE payments SET books_checked_at = ?1
       WHERE id = ?2 AND books_applied_at IS NULL AND (books_checked_at IS NULL OR books_checked_at < ?3)
       RETURNING id`,
    )
    .bind(pass.at, paymentId, pass.recheck)
    .first();
  return claimed !== null;
}

export async function markApplied(pass: Pass, paymentId: string): Promise<void> {
  await pass.db.prepare("UPDATE payments SET books_applied_at = ?1 WHERE id = ?2").bind(pass.at, paymentId).run();
}
