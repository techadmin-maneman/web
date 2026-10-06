// Payments and refunds written to Books by the sync (./books-sync.ts): each captured payment recorded once, a
// visit's payment applied to its invoice, and each processed refund of a recorded payment.

import { rupees } from "@maneman/web-kit/money";
import { indiaDate } from "../../lib/india-time.ts";
import { isRefusal } from "../../providers/provider-error.ts";
import { paymentsTab } from "../ops/alerts.ts";
import { tellUnapplied } from "./books-kept.ts";
import { type Pass, claimToRecord, tellFailure, closeFailures, claimToApply, markApplied } from "./books-pass.ts";
import { type PaymentPaidFor, supplyOf } from "./receipt-supply.ts";
import { PER_PASS } from "./vendor-pass.ts";

// ---------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------
interface PaymentToRecord extends PaymentPaidFor {
  id: string;
  person_id: string;
  razorpay_payment_id: string;
  reference: string | null;
  amount: number;
  captured_at: string;
  books_customer_id: string;
}

/** Payments of clients with a Books customer, with the visit or the booking each paid for. */
export async function paymentsToRecord(pass: Pass): Promise<PaymentToRecord[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT p.id, p.person_id, p.razorpay_payment_id, p.reference, p.amount, p.captured_at, pe.books_customer_id,
         p.kind, COALESCE(a.type, h.type) AS visit_type, a.window_start AS visit_start, h.date AS visit_day
       FROM payments p JOIN people pe ON pe.id = p.person_id
         LEFT JOIN appointments a ON a.id = p.appointment_id
         LEFT JOIN slot_holds h ON h.razorpay_order_id = p.razorpay_order_id
       WHERE p.books_payment_id IS NULL AND p.captured_at IS NOT NULL AND pe.books_customer_id IS NOT NULL
         AND (p.books_checked_at IS NULL OR p.books_checked_at < ?1)
       ORDER BY p.captured_at LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<PaymentToRecord>();
  return results;
}

/** True when Books has it now. */
export async function recordPayment(pass: Pass, payment: PaymentToRecord): Promise<boolean> {
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
        supply: `${pass.label}${supplyOf(payment)}`,
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
export async function paymentsToApply(pass: Pass): Promise<PaymentToApply[]> {
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
export async function applyPayment(pass: Pass, payment: PaymentToApply): Promise<boolean> {
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
    await tellUnapplied(
      pass.deps.alertOnce,
      payment,
      `invoice ${payment.fsm_invoice_id} is ${invoice?.status ?? "missing"}`,
    );
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
export async function refundsToRecord(pass: Pass): Promise<RefundToRecord[]> {
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
export async function recordRefund(pass: Pass, refund: RefundToRecord, fromAccountId: string): Promise<boolean> {
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
