// Payments and refunds written to Zoho Books, so Books issues their receipts
// (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). It runs on the
// five-minute cron, not in the payment's path: Books is never on the way to a
// booking.
//
// Each pass does a little of six things, oldest first:
//   - makes the Books customer of each client with money or a finished visit to
//     record (src/domain/books-customers.ts);
//   - writes a client's new number or address to their customer;
//   - records each captured payment whose client Books has, once;
//   - applies a visit's payment to its invoice, once Books has sent it, and tells
//     ops of any part the invoice did not owe;
//   - tells ops of money kept that no invoice will come to be set against: what
//     a late cancel or replacement kept, a no-show's charge, and a late fee;
//   - records each processed refund of a recorded payment, from the account
//     Razorpay settles into, when that account is set.
//
// Each record is claimed before Books is asked, so a run that overlaps the one
// before it leaves the records that one is on. A payment or a refund is also
// looked for in Books by our reference before it is recorded, so a try whose
// answer never came is not recorded a second time.
//
// Each record is handled on its own (docs/decisions/0067-alerts-and-silent-failures.md).
// One found not ready, or that fails, waits an hour before Books is asked again,
// as Books allows a few thousand calls a day, and the pass carries on with the
// rest. A refusal is told to ops at once; any other failure once it has
// happened three times. Each record is paid for from the cron run's outside
// calls first, and the pass stops when they are spent.

import type { GstRegistration } from "../config/gst.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { failureReason, type Logger } from "../log.ts";
import type { BooksProvider } from "../providers/books.ts";
import { isRefusal } from "../providers/provider-error.ts";
import { paymentsTab, type AlertOnce, type ResolveAlert } from "./alerts.ts";
import { customerFor, updateCustomerOf } from "./books-customers.ts";
import { HOUR_MS } from "../lib/durations.ts";

/** How many of each a pass handles at most. */
export const PER_PASS = 5;
export const RECHECK_AFTER_MS = HOUR_MS;
/** Outside calls one record may cost: Books' look for it, Books' record, and the alert it may send. */
export const CALLS_PER_RECORD = 3;
/** Outside calls one customer may cost: Books' write, and the alert it may send. */
export const CALLS_PER_CUSTOMER = 2;
/** A failure other than a refusal is told once it has happened this many times, an hour apart. */
const FAILURES_BEFORE_ALERT = 3;

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

export type BooksSyncSummary = {
  customers: number;
  customersUpdated: number;
  recorded: number;
  applied: number;
  refunded: number;
};

const describe = (error: unknown): string => failureReason(error, 200);

interface Pass {
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

export async function syncBooks(
  db: D1Database,
  deps: BooksSyncDeps,
  options: BooksSyncOptions,
  now: Date,
  log: Logger,
  budget: CallBudget,
): Promise<BooksSyncSummary> {
  const pass: Pass = {
    db,
    deps,
    options,
    log,
    at: now.toISOString(),
    recheck: new Date(now.getTime() - RECHECK_AFTER_MS).toISOString(),
    label: options.labelAsTest ? "Staging test: " : "",
  };
  const summary: BooksSyncSummary = { customers: 0, customersUpdated: 0, recorded: 0, applied: 0, refunded: 0 };

  for (const personId of await customersToAdd(pass)) {
    if (!budget.spend(CALLS_PER_CUSTOMER)) return summary;
    if (await addCustomer(pass, personId)) summary.customers += 1;
  }
  for (const personId of await customersToUpdate(pass)) {
    if (!budget.spend(CALLS_PER_CUSTOMER)) return summary;
    if (await updateCustomer(pass, personId)) summary.customersUpdated += 1;
  }
  for (const payment of await paymentsToRecord(pass)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await recordPayment(pass, payment)) summary.recorded += 1;
  }
  for (const payment of await paymentsToApply(pass)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await applyPayment(pass, payment)) summary.applied += 1;
  }
  for (const kept of await keptMoney(pass)) {
    if (!budget.spend(1)) return summary;
    await tellKept(pass, kept);
  }
  if (options.refundAccountId === null) return summary;
  for (const refund of await refundsToRecord(pass)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await recordRefund(pass, refund, options.refundAccountId)) summary.refunded += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Making a client's customer
// ---------------------------------------------------------------------------

/**
 * People with no customer yet and a captured payment not yet recorded, or a finished visit to invoice. Read from what
 * waits on them, so only the waiting rows are read; one with two such rows is listed once.
 */
async function customersToAdd(pass: Pass): Promise<string[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT pe.id FROM (
         SELECT p.person_id AS id FROM payments p WHERE p.books_payment_id IS NULL AND p.captured_at IS NOT NULL
         UNION ALL
         SELECT a.person_id AS id FROM appointments a
         WHERE a.status = 'completed' AND a.invoice_issued_at IS NULL AND a.deleted_at IS NULL
           AND a.type IN ('first_fit', 'service', 'replacement') AND a.one_visit IS NOT 'declined') waiting
       JOIN people pe ON pe.id = waiting.id
       WHERE pe.books_customer_id IS NULL AND pe.erased_at IS NULL
         AND (pe.books_checked_at IS NULL OR pe.books_checked_at < ?1)
       LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<{ id: string }>();
  return [...new Set(results.map((row) => row.id))];
}

/** True when the person has a customer now. */
async function addCustomer(pass: Pass, personId: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE people SET books_checked_at = ?1
       WHERE id = ?2 AND books_customer_id IS NULL AND (books_checked_at IS NULL OR books_checked_at < ?3)
       RETURNING id`,
    )
    .bind(pass.at, personId, pass.recheck)
    .first();
  if (claimed === null) return false;

  const failed = {
    kind: "customer",
    id: personId,
    personId,
    what: `client ${personId}'s customer record`,
    then: "It is asked again every hour.",
  } as const;
  try {
    const customerId = await customerFor(pass.db, pass.deps.books, personId, pass.options.gst);
    if (customerId === null) return false;
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await closeFailures(pass, failed);
  return true;
}

// ---------------------------------------------------------------------------
// Writing a client's new number or address to their customer
// ---------------------------------------------------------------------------

/** People with a customer whose number or address changed after it was last written. */
async function customersToUpdate(pass: Pass): Promise<string[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT id FROM people
       WHERE books_details_changed_at IS NOT NULL AND books_customer_id IS NOT NULL AND erased_at IS NULL
         AND (books_checked_at IS NULL OR books_checked_at < ?1)
       ORDER BY books_details_changed_at LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/** True when Books has the client's details as they were when this pass read them. */
async function updateCustomer(pass: Pass, personId: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE people SET books_checked_at = ?1
       WHERE id = ?2 AND books_details_changed_at IS NOT NULL AND (books_checked_at IS NULL OR books_checked_at < ?3)
       RETURNING books_details_changed_at`,
    )
    .bind(pass.at, personId, pass.recheck)
    .first<{ books_details_changed_at: string }>();
  if (claimed === null) return false;

  const failed = {
    kind: "customer_update",
    id: personId,
    personId,
    what: `client ${personId}'s new number or address`,
    then: "It is asked again every hour.",
  } as const;
  try {
    const updated = await updateCustomerOf(pass.db, pass.deps.books, personId, pass.options.gst);
    if (!updated) return false;
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await pass.db.batch([
    // A change made while Books was being written keeps its mark, for the next pass.
    pass.db
      .prepare("UPDATE people SET books_details_changed_at = NULL WHERE id = ?1 AND books_details_changed_at = ?2")
      .bind(personId, claimed.books_details_changed_at),
    pass.db.prepare("UPDATE people SET books_checked_at = NULL WHERE id = ?1").bind(personId),
  ]);
  await closeFailures(pass, failed);
  return true;
}

// ---------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------

interface PaymentToRecord {
  id: string;
  person_id: string;
  razorpay_payment_id: string;
  reference: string | null;
  amount: number;
  captured_at: string;
  books_customer_id: string;
}

/** Payments of clients with a Books customer. */
async function paymentsToRecord(pass: Pass): Promise<PaymentToRecord[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT p.id, p.person_id, p.razorpay_payment_id, p.reference, p.amount, p.captured_at, pe.books_customer_id
       FROM payments p JOIN people pe ON pe.id = p.person_id
       WHERE p.books_payment_id IS NULL AND p.captured_at IS NOT NULL AND pe.books_customer_id IS NOT NULL
         AND (p.books_checked_at IS NULL OR p.books_checked_at < ?1)
       ORDER BY p.captured_at LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<PaymentToRecord>();
  return results;
}

/** True when Books has it now. */
async function recordPayment(pass: Pass, payment: PaymentToRecord): Promise<boolean> {
  const { db, deps } = pass;
  if (!(await claimToRecord(pass, payment.id))) return false;
  const failed = {
    kind: "payment",
    id: payment.id,
    personId: payment.person_id,
    what: `payment ${payment.id} (Razorpay ${payment.razorpay_payment_id})`,
    then: "It is asked again every hour.",
  } as const;
  try {
    const customerId = payment.books_customer_id;
    const reference = payment.reference ?? payment.razorpay_payment_id;
    // An earlier try whose answer never came may have recorded it already.
    const booksPaymentId =
      (await deps.books.findPayment(customerId, reference)) ??
      (await deps.books.recordPayment({
        customerId,
        amount: payment.amount,
        date: indiaDate(new Date(payment.captured_at)),
        reference,
        description: `${pass.label}Razorpay payment ${payment.razorpay_payment_id}`,
      }));
    await db
      .prepare("UPDATE payments SET books_payment_id = ?1, books_checked_at = NULL WHERE id = ?2")
      .bind(booksPaymentId, payment.id)
      .run();
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await closeFailures(pass, failed);
  return true;
}

// ---------------------------------------------------------------------------
// Applying a payment to its invoice
// ---------------------------------------------------------------------------

interface PaymentToApply {
  id: string;
  person_id: string;
  books_payment_id: string;
  amount: number;
  fsm_invoice_id: string;
}

/**
 * A visit's payment taken in advance, set against its invoice once Books has sent it. A late fee is not the visit's
 * price, so it is never set against the visit's invoice: it is kept money (below).
 */
async function paymentsToApply(pass: Pass): Promise<PaymentToApply[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT p.id, p.person_id, p.books_payment_id, p.amount, a.fsm_invoice_id
       FROM payments p JOIN appointments a ON a.id = p.appointment_id
       WHERE p.books_payment_id IS NOT NULL AND p.books_applied_at IS NULL AND a.fsm_invoice_id IS NOT NULL
         AND p.status = 'captured' AND p.kind = 'visit'
         AND (p.books_checked_at IS NULL OR p.books_checked_at < ?1)
       ORDER BY p.captured_at LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<PaymentToApply>();
  return results;
}

/** True when it was set against its invoice now. */
async function applyPayment(pass: Pass, payment: PaymentToApply): Promise<boolean> {
  const { deps } = pass;
  if (!(await claimToApply(pass, payment.id))) return false;
  const failed = {
    kind: "apply",
    id: payment.id,
    personId: payment.person_id,
    what: `payment ${payment.id} against invoice ${payment.fsm_invoice_id}`,
    then: "Set it against the invoice in Books by hand.",
  } as const;

  let invoice;
  try {
    invoice = await deps.books.invoice(payment.fsm_invoice_id);
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  // A draft waits the hour its claim holds it for.
  if (invoice?.status === "draft") return false;
  if (invoice === null || invoice.status === "void" || invoice.balance === 0) {
    pass.log.warn("books_apply_skipped", { payment_id: payment.id, invoice_status: invoice?.status ?? "missing" });
    await tellUnapplied(pass, payment, `invoice ${payment.fsm_invoice_id} is ${invoice?.status ?? "missing"}`);
    await markApplied(pass, payment.id);
    return false;
  }

  const applied = Math.min(payment.amount, invoice.balance);
  try {
    await deps.books.applyToInvoice(payment.books_payment_id, invoice.id, applied);
  } catch (error) {
    await tellFailure(pass, failed, error);
    // A refusal is not asked again, and ops set it by hand; anything else is, in an hour.
    if (isRefusal(error)) await markApplied(pass, payment.id);
    return false;
  }
  await markApplied(pass, payment.id);
  await closeFailures(pass, failed);
  if (applied < payment.amount) await tellLeftOver(pass, payment, invoice.balance);
  return true;
}

/** What the invoice did not owe of the payment stays in Books as the client's credit, and ops are told once. */
async function tellLeftOver(pass: Pass, payment: PaymentToApply, owed: number): Promise<void> {
  const left = payment.amount - owed;
  await pass.deps.alertOnce({
    key: `books_unapplied:${payment.id}`,
    message:
      `Payment ${payment.id} (Books ${payment.books_payment_id}) was ${rupees(payment.amount)}, and invoice ` +
      `${payment.fsm_invoice_id} owed ${rupees(owed)} of it, so ${rupees(left)} has nothing to be set against. ` +
      "It stays in Books as credit owed to the client until it is settled by hand.",
    link: paymentsTab(payment.person_id),
  });
}

// ---------------------------------------------------------------------------
// Money kept, with nothing to set it against
// ---------------------------------------------------------------------------

interface KeptRow {
  id: string;
  person_id: string;
  books_payment_id: string;
  appointment_id: string | null;
  kind: "visit" | "late_fee";
  amount: number;
  refunded_amount: number;
  change: "cancelled" | "replaced" | null;
  change_kept: number | null;
  no_show_kept: number | null;
}

/**
 * Payments Books has that no invoice will ever be set against, though some of the money is kept: a visit's payment
 * part kept by a late cancel or replacement, or by a no-show's charge, and a late fee for moving a visit, which is
 * not the visit's price. What is kept sits in Books as the client's credit.
 */
async function keptMoney(pass: Pass): Promise<KeptRow[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT p.id, p.person_id, p.books_payment_id, p.appointment_id, p.kind, p.amount, p.refunded_amount,
         c.kind AS change, c.kept_amount AS change_kept, n.kept_amount AS no_show_kept
       FROM payments p
       LEFT JOIN visit_changes c ON c.payment_id = p.id AND c.kind IN ('cancelled', 'replaced') AND c.kept_amount > 0
       LEFT JOIN no_show_cases n ON n.appointment_id = p.appointment_id AND p.kind = 'visit'
         AND n.decision = 'charged' AND n.kept_amount > 0
       WHERE p.books_payment_id IS NOT NULL AND p.books_applied_at IS NULL
         AND ((p.kind = 'late_fee' AND p.amount > p.refunded_amount) OR c.id IS NOT NULL OR n.id IS NOT NULL)
       ORDER BY p.captured_at LIMIT ?1`,
    )
    .bind(PER_PASS)
    .all<KeptRow>();
  return results;
}

/** What was kept, and why, in the words ops read. */
function keptFor(kept: KeptRow): string {
  const visit = kept.appointment_id ?? "unknown";
  if (kept.change !== null) return `visit ${visit} was ${kept.change} and ${rupees(kept.change_kept ?? 0)} of it kept`;
  if (kept.no_show_kept !== null) return `visit ${visit} was a no-show and ${rupees(kept.no_show_kept)} of it kept`;
  return `it is the late fee for moving visit ${visit}, and ${rupees(kept.amount - kept.refunded_amount)} of it kept`;
}

/** Told once: the payment is claimed as dealt with first, so an overlapping run does not tell it again. */
async function tellKept(pass: Pass, kept: KeptRow): Promise<void> {
  const claimed = await pass.db
    .prepare("UPDATE payments SET books_applied_at = ?1 WHERE id = ?2 AND books_applied_at IS NULL RETURNING id")
    .bind(pass.at, kept.id)
    .first();
  if (claimed === null) return;
  await tellUnapplied(pass, kept, keptFor(kept));
}

/**
 * Ops settle it by hand. How kept money is invoiced, so that it does not
 * stay the client's credit, waits for the CA (docs/open-points.md, item 16).
 */
async function tellUnapplied(
  pass: Pass,
  payment: { id: string; person_id: string; books_payment_id: string },
  why: string,
): Promise<void> {
  await pass.deps.alertOnce({
    key: `books_unapplied:${payment.id}`,
    message:
      `Payment ${payment.id} (Books ${payment.books_payment_id}) has nothing to be set against: ${why}. ` +
      "It stays in Books as credit owed to the client until it is settled by hand.",
    link: paymentsTab(payment.person_id),
  });
}

// ---------------------------------------------------------------------------
// Recording a refund
// ---------------------------------------------------------------------------

interface RefundToRecord {
  id: string;
  person_id: string;
  razorpay_refund_id: string;
  amount: number;
  processed_at: string | null;
  created_at: string;
  books_payment_id: string;
}

/** Refunds Razorpay has processed, of payments Books has. */
async function refundsToRecord(pass: Pass): Promise<RefundToRecord[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT r.id, p.person_id, r.razorpay_refund_id, r.amount, r.processed_at, r.created_at, p.books_payment_id
       FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE r.status = 'processed' AND r.books_refund_id IS NULL AND p.books_payment_id IS NOT NULL
         AND (r.books_checked_at IS NULL OR r.books_checked_at < ?1)
       ORDER BY r.created_at LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<RefundToRecord>();
  return results;
}

/** True when Books has it now. */
async function recordRefund(pass: Pass, refund: RefundToRecord, fromAccountId: string): Promise<boolean> {
  const { db, deps } = pass;
  const claimed = await db
    .prepare(
      `UPDATE refunds SET books_checked_at = ?1
       WHERE id = ?2 AND books_refund_id IS NULL AND (books_checked_at IS NULL OR books_checked_at < ?3)
       RETURNING id`,
    )
    .bind(pass.at, refund.id, pass.recheck)
    .first();
  if (claimed === null) return false;
  const failed = {
    kind: "refund",
    id: refund.id,
    personId: refund.person_id,
    what: `refund ${refund.id} (Razorpay ${refund.razorpay_refund_id})`,
    then: "It is asked again every hour.",
  } as const;
  try {
    const booksRefundId =
      (await deps.books.findRefund(refund.books_payment_id, refund.razorpay_refund_id)) ??
      (await deps.books.recordRefund(refund.books_payment_id, {
        amount: refund.amount,
        date: indiaDate(new Date(refund.processed_at ?? refund.created_at)),
        reference: refund.razorpay_refund_id,
        description: `${pass.label}Razorpay refund ${refund.razorpay_refund_id}`,
        fromAccountId,
      }));
    await db.prepare("UPDATE refunds SET books_refund_id = ?1 WHERE id = ?2").bind(booksRefundId, refund.id).run();
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await closeFailures(pass, failed);
  return true;
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

/** Logs the failure, and tells ops of a refusal at once and of any other failure on its third time. */
async function tellFailure(pass: Pass, record: FailedRecord, error: unknown): Promise<void> {
  const idField = ID_FIELDS[record.kind];
  const link = linkOf(record);
  if (isRefusal(error)) {
    pass.log.warn(`books_${record.kind}_refused`, { [idField]: record.id, status: error.status, code: error.code });
    await pass.deps.alertOnce({
      key: `books_${record.kind}_refused:${record.id}`,
      message: `Books refused ${record.what}: ${String(error.status)} ${error.code}. ${record.then}`,
      link,
    });
    return;
  }
  pass.log.warn(`books_${record.kind}_failed`, { [idField]: record.id, error });
  await pass.deps.alertOnce({
    key: `books_${record.kind}_failed:${record.id}`,
    message: `Books has failed ${String(FAILURES_BEFORE_ALERT)} times on ${record.what}: ${describe(error)}. ${record.then}`,
    link,
    after: FAILURES_BEFORE_ALERT,
  });
}

/** Once a record goes through, whatever was told about it is over. */
async function closeFailures(pass: Pass, record: FailedRecord): Promise<void> {
  await pass.deps.resolveAlert(`books_${record.kind}_refused:${record.id}`);
  await pass.deps.resolveAlert(`books_${record.kind}_failed:${record.id}`);
}

/**
 * Takes the payment for this pass, marking it tried now, so an overlapping run leaves it and a failure waits an hour;
 * false where another run took it first, or has recorded it since.
 */
async function claimToRecord(pass: Pass, paymentId: string): Promise<boolean> {
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
async function claimToApply(pass: Pass, paymentId: string): Promise<boolean> {
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

async function markApplied(pass: Pass, paymentId: string): Promise<void> {
  await pass.db.prepare("UPDATE payments SET books_applied_at = ?1 WHERE id = ?2").bind(pass.at, paymentId).run();
}

const rupees = (paise: number): string => `Rs. ${String(paise / 100)}`;
