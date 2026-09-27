// Payments and refunds written to Zoho Books, so Books issues their receipts
// (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). It runs on the
// five-minute cron, not in the payment's path: Books is never on the way to a
// booking, and a client's customer record reaches Books only when FSM's sync
// next runs, every two to three hours.
//
// Each pass does a little of four things, oldest first:
//   - records each captured payment whose client Books has, once;
//   - applies a recorded payment to its visit's invoice, once Books has sent it;
//   - tells ops of a recorded payment kept as a charge on a cancelled visit,
//     which no invoice will come to be set against;
//   - records each processed refund of a recorded payment, from the account
//     Razorpay settles into, when that account is set.
//
// A payment or a refund is looked for in Books by our reference before it is
// recorded, so a try whose answer never came is not recorded a second time.
//
// Each record is handled on its own (docs/decisions/0067-alerts-and-silent-failures.md).
// One found not ready, or that fails, waits an hour before Books is asked again,
// as Books allows a few thousand calls a day, and the pass carries on with the
// rest. A refusal is told to ops at once; any other failure once it has
// happened three times. Each record is paid for from the cron run's outside
// calls first, and the pass stops when they are spent.

import { indiaDate } from "../lib/india-time.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { scrubString, type Logger } from "../log.ts";
import type { BooksProvider } from "../providers/books.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { isRefusal } from "../providers/provider-error.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { HOUR_MS } from "../lib/durations.ts";

/** How many of each a pass handles at most. */
export const PER_PASS = 5;
export const RECHECK_AFTER_MS = HOUR_MS;
/** Outside calls one record may cost: FSM or Books, Books' look for it, Books' record, and the alert it may send. */
export const CALLS_PER_RECORD = 4;
/** A failure other than a refusal is told once it has happened this many times, an hour apart. */
const FAILURES_BEFORE_ALERT = 3;

export interface BooksSyncOptions {
  readonly refundAccountId: string | null;
  readonly labelAsTest: boolean;
}

export interface BooksSyncDeps {
  readonly fsm: FsmProvider;
  readonly books: BooksProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
}

export type BooksSyncSummary = { recorded: number; applied: number; refunded: number };

const describe = (error: unknown): string =>
  scrubString(error instanceof Error ? error.message : "unknown error").slice(0, 200);

interface Pass {
  readonly db: D1Database;
  readonly deps: BooksSyncDeps;
  readonly log: Logger;
  /** Now, as stored. */
  readonly at: string;
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
  const pass: Pass = { db, deps, log, at: now.toISOString(), label: options.labelAsTest ? "Staging test: " : "" };
  const recheck = new Date(now.getTime() - RECHECK_AFTER_MS).toISOString();
  const summary: BooksSyncSummary = { recorded: 0, applied: 0, refunded: 0 };

  for (const payment of await paymentsToRecord(db, recheck)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await recordPayment(pass, payment)) summary.recorded += 1;
  }
  for (const payment of await paymentsToApply(db, recheck)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await applyPayment(pass, payment)) summary.applied += 1;
  }
  for (const charge of await keptCharges(db)) {
    if (!budget.spend(1)) return summary;
    await tellUnapplied(
      pass,
      charge,
      `visit ${charge.appointment_id} was cancelled and ${rupees(charge.kept)} of it kept`,
    );
    await markApplied(pass, charge.id);
  }
  if (options.refundAccountId === null) return summary;
  for (const refund of await refundsToRecord(db, recheck)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await recordRefund(pass, refund, options.refundAccountId)) summary.refunded += 1;
  }
  return summary;
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
  fsm_contact_id: string;
}

async function paymentsToRecord(db: D1Database, recheck: string): Promise<PaymentToRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.person_id, p.razorpay_payment_id, p.reference, p.amount, p.captured_at, pe.fsm_contact_id
       FROM payments p JOIN people pe ON pe.id = p.person_id
       WHERE p.books_payment_id IS NULL AND p.captured_at IS NOT NULL AND pe.fsm_contact_id IS NOT NULL
         AND (p.books_checked_at IS NULL OR p.books_checked_at < ?1)
       ORDER BY p.captured_at LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<PaymentToRecord>();
  return results;
}

/** True when Books has it now. */
async function recordPayment(pass: Pass, payment: PaymentToRecord): Promise<boolean> {
  const { db, deps } = pass;
  const failed = {
    kind: "payment",
    id: payment.id,
    personId: payment.person_id,
    what: `payment ${payment.id} (Razorpay ${payment.razorpay_payment_id})`,
    then: "It is asked again every hour.",
  } as const;
  try {
    const customerId = (await deps.fsm.contact(payment.fsm_contact_id))?.booksCustomerId ?? null;
    if (customerId === null) {
      await checkPaymentLater(pass, payment.id);
      return false;
    }
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
    await checkPaymentLater(pass, payment.id);
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

/** A payment taken in advance, set against its visit's invoice once Books has sent it. */
async function paymentsToApply(db: D1Database, recheck: string): Promise<PaymentToApply[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.person_id, p.books_payment_id, p.amount, a.fsm_invoice_id
       FROM payments p JOIN appointments a ON a.id = p.appointment_id
       WHERE p.books_payment_id IS NOT NULL AND p.books_applied_at IS NULL AND a.fsm_invoice_id IS NOT NULL
         AND p.status = 'captured' AND (p.books_checked_at IS NULL OR p.books_checked_at < ?1)
       ORDER BY p.captured_at LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<PaymentToApply>();
  return results;
}

/** True when it was set against its invoice now. */
async function applyPayment(pass: Pass, payment: PaymentToApply): Promise<boolean> {
  const { deps } = pass;
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
    await checkPaymentLater(pass, payment.id);
    await tellFailure(pass, failed, error);
    return false;
  }
  if (invoice?.status === "draft") {
    await checkPaymentLater(pass, payment.id);
    return false;
  }
  if (invoice === null || invoice.status === "void" || invoice.balance === 0) {
    pass.log.warn("books_apply_skipped", { payment_id: payment.id, invoice_status: invoice?.status ?? "missing" });
    await tellUnapplied(pass, payment, `invoice ${payment.fsm_invoice_id} is ${invoice?.status ?? "missing"}`);
    await markApplied(pass, payment.id);
    return false;
  }

  try {
    await deps.books.applyToInvoice(payment.books_payment_id, invoice.id, Math.min(payment.amount, invoice.balance));
  } catch (error) {
    await tellFailure(pass, failed, error);
    // A refusal is not asked again, and ops set it by hand; anything else is, in an hour.
    if (isRefusal(error)) await markApplied(pass, payment.id);
    else await checkPaymentLater(pass, payment.id);
    return false;
  }
  await markApplied(pass, payment.id);
  await closeFailures(pass, failed);
  return true;
}

// ---------------------------------------------------------------------------
// A charge kept, with nothing to set it against
// ---------------------------------------------------------------------------

interface KeptCharge {
  id: string;
  person_id: string;
  books_payment_id: string;
  appointment_id: string;
  kept: number;
}

/**
 * A payment Books has, on a visit cancelled or replaced late, with part of it
 * kept as the charge. The visit is never invoiced, so the payment is never
 * applied, and what was kept sits in Books as the client's credit.
 */
async function keptCharges(db: D1Database): Promise<KeptCharge[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.person_id, p.books_payment_id, c.appointment_id, c.kept_amount AS kept
       FROM payments p JOIN visit_changes c ON c.payment_id = p.id
       WHERE p.books_payment_id IS NOT NULL AND p.books_applied_at IS NULL
         AND c.kind IN ('cancelled', 'replaced') AND c.kept_amount > 0
       ORDER BY p.captured_at LIMIT ?1`,
    )
    .bind(PER_PASS)
    .all<KeptCharge>();
  return results;
}

/**
 * Ops settle it by hand. How a kept charge is invoiced, so that it does not
 * stay the client's credit, waits for the CA (docs/open-points.md, item 79).
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
    link: `/clients/${payment.person_id}`,
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
async function refundsToRecord(db: D1Database, recheck: string): Promise<RefundToRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, p.person_id, r.razorpay_refund_id, r.amount, r.processed_at, r.created_at, p.books_payment_id
       FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE r.status = 'processed' AND r.books_refund_id IS NULL AND p.books_payment_id IS NOT NULL
         AND (r.books_checked_at IS NULL OR r.books_checked_at < ?1)
       ORDER BY r.created_at LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<RefundToRecord>();
  return results;
}

/** True when Books has it now. */
async function recordRefund(pass: Pass, refund: RefundToRecord, fromAccountId: string): Promise<boolean> {
  const { db, deps } = pass;
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
    await db.prepare("UPDATE refunds SET books_checked_at = ?1 WHERE id = ?2").bind(pass.at, refund.id).run();
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
  readonly kind: "payment" | "apply" | "refund";
  readonly id: string;
  readonly personId: string;
  /** "payment <id> (Razorpay <id>)", or what Books was asked to do with it. */
  readonly what: string;
  /** What happens next, or what ops must do. */
  readonly then: string;
}

/** Logs the failure, and tells ops of a refusal at once and of any other failure on its third time. */
async function tellFailure(pass: Pass, record: FailedRecord, error: unknown): Promise<void> {
  const idField = `${record.kind === "refund" ? "refund" : "payment"}_id`;
  const link = `/clients/${record.personId}`;
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

async function checkPaymentLater(pass: Pass, paymentId: string): Promise<void> {
  await pass.db.prepare("UPDATE payments SET books_checked_at = ?1 WHERE id = ?2").bind(pass.at, paymentId).run();
}

async function markApplied(pass: Pass, paymentId: string): Promise<void> {
  await pass.db.prepare("UPDATE payments SET books_applied_at = ?1 WHERE id = ?2").bind(pass.at, paymentId).run();
}

const rupees = (paise: number): string => `Rs. ${String(paise / 100)}`;
