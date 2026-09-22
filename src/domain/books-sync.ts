// Payments and refunds written to Zoho Books, so Books issues their receipts
// (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). It runs on the
// five-minute cron, not in the payment's path: Books is never on the way to a
// booking, and a client's customer record reaches Books only when FSM's sync
// next runs, every two to three hours.
//
// Each pass does a little of three things, oldest first:
//   - records each captured payment whose client Books has, once;
//   - applies a recorded payment to its visit's invoice, once Books has sent it;
//   - records each processed refund of a recorded payment, from the account
//     Razorpay settles into, when that account is set.
// A record found not ready, or refused, waits an hour before Books is asked
// again, as Books allows a few thousand calls a day. A refusal is logged for ops.

import { indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import type { BooksProvider } from "../providers/books.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { ZohoError } from "../providers/zoho-http.ts";

/** How many of each a pass handles, well inside a cron run's 50 outside calls. */
export const PER_PASS = 5;
export const RECHECK_AFTER_MS = 60 * 60 * 1000;

export interface BooksSyncOptions {
  readonly refundAccountId: string | null;
  readonly labelAsTest: boolean;
}

export type BooksSyncSummary = { recorded: number; applied: number; refunded: number };

/** Books refuses it: a 4xx, which asking again at once will not change. */
const refused = (error: unknown): error is ZohoError =>
  error instanceof ZohoError && error.status >= 400 && error.status < 500;

export async function syncBooks(
  db: D1Database,
  fsm: FsmProvider,
  books: BooksProvider,
  options: BooksSyncOptions,
  now: Date,
  log: Logger,
): Promise<BooksSyncSummary> {
  const at = now.toISOString();
  const recheck = new Date(now.getTime() - RECHECK_AFTER_MS).toISOString();
  const label = options.labelAsTest ? "Staging test: " : "";
  const summary: BooksSyncSummary = { recorded: 0, applied: 0, refunded: 0 };
  const notReady = (paymentId: string) =>
    db.prepare("UPDATE payments SET books_checked_at = ?1 WHERE id = ?2").bind(at, paymentId).run();

  const { results: payments } = await db
    .prepare(
      `SELECT p.id, p.razorpay_payment_id, p.reference, p.amount, p.captured_at, pe.fsm_contact_id
       FROM payments p JOIN people pe ON pe.id = p.person_id
       WHERE p.books_payment_id IS NULL AND p.captured_at IS NOT NULL AND pe.fsm_contact_id IS NOT NULL
         AND (p.books_checked_at IS NULL OR p.books_checked_at < ?1)
       ORDER BY p.captured_at LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<{
      id: string;
      razorpay_payment_id: string;
      reference: string | null;
      amount: number;
      captured_at: string;
      fsm_contact_id: string;
    }>();
  for (const payment of payments) {
    const customerId = (await fsm.contact(payment.fsm_contact_id))?.booksCustomerId ?? null;
    if (customerId === null) {
      await notReady(payment.id);
      continue;
    }
    let booksPaymentId: string;
    try {
      booksPaymentId = await books.recordPayment({
        customerId,
        amount: payment.amount,
        date: indiaDate(new Date(payment.captured_at)),
        reference: payment.reference ?? payment.razorpay_payment_id,
        description: `${label}Razorpay payment ${payment.razorpay_payment_id}`,
      });
    } catch (error) {
      if (!refused(error)) throw error;
      log.warn("books_payment_refused", { payment_id: payment.id, status: error.status, code: error.code });
      await notReady(payment.id);
      continue;
    }
    await db
      .prepare("UPDATE payments SET books_payment_id = ?1, books_checked_at = NULL WHERE id = ?2")
      .bind(booksPaymentId, payment.id)
      .run();
    summary.recorded += 1;
  }

  // A payment taken in advance, set against its visit's invoice once Books has sent it.
  const { results: toApply } = await db
    .prepare(
      `SELECT p.id, p.books_payment_id, p.amount, a.fsm_invoice_id
       FROM payments p JOIN appointments a ON a.id = p.appointment_id
       WHERE p.books_payment_id IS NOT NULL AND p.books_applied_at IS NULL AND a.fsm_invoice_id IS NOT NULL
         AND p.status = 'captured' AND (p.books_checked_at IS NULL OR p.books_checked_at < ?1)
       ORDER BY p.captured_at LIMIT ?2`,
    )
    .bind(recheck, PER_PASS)
    .all<{ id: string; books_payment_id: string; amount: number; fsm_invoice_id: string }>();
  for (const payment of toApply) {
    const invoice = await books.invoice(payment.fsm_invoice_id);
    if (invoice?.status === "draft") {
      await notReady(payment.id);
      continue;
    }
    if (invoice === null || invoice.status === "void" || invoice.balance === 0) {
      // Nothing to set it against: ops settle it by hand.
      log.warn("books_apply_skipped", { payment_id: payment.id, invoice_status: invoice?.status ?? "missing" });
    } else {
      try {
        await books.applyToInvoice(payment.books_payment_id, invoice.id, Math.min(payment.amount, invoice.balance));
        summary.applied += 1;
      } catch (error) {
        if (!refused(error)) throw error;
        log.warn("books_apply_refused", { payment_id: payment.id, status: error.status, code: error.code });
      }
    }
    await db.prepare("UPDATE payments SET books_applied_at = ?1 WHERE id = ?2").bind(at, payment.id).run();
  }

  // Refunds Razorpay has processed, of payments Books has.
  if (options.refundAccountId !== null) {
    const { results: refunds } = await db
      .prepare(
        `SELECT r.id, r.razorpay_refund_id, r.amount, r.processed_at, r.created_at, p.books_payment_id
         FROM refunds r JOIN payments p ON p.id = r.payment_id
         WHERE r.status = 'processed' AND r.books_refund_id IS NULL AND p.books_payment_id IS NOT NULL
           AND (r.books_checked_at IS NULL OR r.books_checked_at < ?1)
         ORDER BY r.created_at LIMIT ?2`,
      )
      .bind(recheck, PER_PASS)
      .all<{
        id: string;
        razorpay_refund_id: string;
        amount: number;
        processed_at: string | null;
        created_at: string;
        books_payment_id: string;
      }>();
    for (const refund of refunds) {
      let booksRefundId: string;
      try {
        booksRefundId = await books.recordRefund(refund.books_payment_id, {
          amount: refund.amount,
          date: indiaDate(new Date(refund.processed_at ?? refund.created_at)),
          reference: refund.razorpay_refund_id,
          description: `${label}Razorpay refund ${refund.razorpay_refund_id}`,
          fromAccountId: options.refundAccountId,
        });
      } catch (error) {
        if (!refused(error)) throw error;
        log.warn("books_refund_refused", { refund_id: refund.id, status: error.status, code: error.code });
        await db.prepare("UPDATE refunds SET books_checked_at = ?1 WHERE id = ?2").bind(at, refund.id).run();
        continue;
      }
      await db.prepare("UPDATE refunds SET books_refund_id = ?1 WHERE id = ?2").bind(booksRefundId, refund.id).run();
      summary.refunded += 1;
    }
  }

  return summary;
}
