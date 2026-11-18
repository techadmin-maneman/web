// A payment refunded by ops, with why: one the client made twice, as when they paid again for a fit that was owed to
// them (docs/decisions/0192-free-remakes.md), or a part of it given back as goodwill. Each goes to Razorpay under a
// receipt that a press again of the same refund shares, so it is made once
// (docs/decisions/0100-a-refund-is-made-once.md): all that is left under the payment's own, `p-<payment>`; a part
// under the key the console's drawer made when it opened, `pp-<key>`, so pressed again after a lost answer it lands
// on the receipt already used, and another part, from a drawer opened again, has its own.

import { rupees } from "@maneman/web-kit/money";
import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { paymentsTab, type AlertOnce } from "../platform/alerts.ts";
import { auditStatement } from "../platform/audit.ts";
import type { Written } from "../platform/audit.ts";
import { askRefund, refundLeftToOps, refundReceipt } from "./refunds.ts";
import { REFUND_NOT_FAILED, statusIn } from "../../config/statuses.ts";
import { paidOutsideRazorpay } from "../../policy/upi.ts";

export type PaymentRefund =
  | { readonly kind: "refunded"; readonly amount: number }
  | { readonly kind: "missing" }
  | { readonly kind: "nothing_left" }
  /** More was asked than is left of the payment. */
  | { readonly kind: "more_than_left" }
  | { readonly kind: "left_to_ops" }
  | { readonly kind: "by_upi" };

type PaidRow = {
  person_id: string;
  razorpay_payment_id: string;
  amount: number;
  /**
   * Refunded, asked for and not yet processed, or owed by a cancel or a no-show ruling and not yet asked for: a ruling's
   * refund comes from the visit's own payment, never its late fee.
   */
  refunded: number;
};

/** The client's captured payment, and how much of it is refunded or on its way back. */
export function capturedPayment(db: D1Database, paymentId: string): Promise<PaidRow | null> {
  return db
    .prepare(
      `SELECT p.person_id, p.razorpay_payment_id, p.amount,
         p.refunded_amount + COALESCE((SELECT SUM(r.amount) FROM refunds r
                                        WHERE r.payment_id = p.id AND r.status = 'created'), 0)
           + COALESCE((SELECT SUM(c.refund_amount) FROM visit_changes c
                        WHERE c.payment_id = p.id AND c.refund_amount > 0
                          AND c.razorpay_refund_id IS NULL AND c.refund_settled_at IS NULL), 0)
           + COALESCE((SELECT SUM(n.amount) FROM no_show_refunds n
                        WHERE n.appointment_id = p.appointment_id AND p.kind = 'visit'
                          AND n.settled_at IS NULL), 0) AS refunded
       FROM payments p WHERE p.id = ?1 AND p.captured_at IS NOT NULL AND p.person_id IS NOT NULL`,
    )
    .bind(paymentId)
    .first<PaidRow>();
}

/** What is left of the payment, or a part of it, refunded with ops' reason; what came of asking Razorpay. */
export async function refundPayment(
  db: D1Database,
  deps: { readonly payments: PaymentsProvider; readonly alertOnce: AlertOnce },
  asked: {
    readonly paymentId: string;
    readonly reason: string;
    /** Part of what is left, with the key of the drawer it was asked from; absent, all that is left. */
    readonly part?: { readonly amount: number; readonly key: string };
  },
  written: Written,
): Promise<PaymentRefund> {
  const paid = await capturedPayment(db, asked.paymentId);
  if (paid === null) return { kind: "missing" };
  const left = paid.amount - paid.refunded;
  if (left <= 0) return { kind: "nothing_left" };
  if (asked.part !== undefined && asked.part.amount > left) return { kind: "more_than_left" };
  const amount = asked.part?.amount ?? left;
  // Paid by UPI to the bank, not through Razorpay: ops refund it the same way (docs/decisions/0209).
  if (paidOutsideRazorpay(paid.razorpay_payment_id)) return { kind: "by_upi" };
  const outcome = await askRefund(
    deps.payments,
    paid.razorpay_payment_id,
    {
      amount,
      receipt: refundReceipt(
        asked.part === undefined
          ? { kind: "payment", paymentId: asked.paymentId }
          : { kind: "payment_part", key: asked.part.key },
      ),
      notes: { payment_id: asked.paymentId, reason: asked.reason },
    },
    { record: { db, now: written.now } },
  );
  if (outcome.kind !== "refunded") {
    await deps.alertOnce({
      key: `payment_refund:${asked.paymentId}`,
      message: refundLeftToOps(outcome.kind, `${rupees(amount)} of a payment`, paid.razorpay_payment_id, amount),
      link: paymentsTab(paid.person_id),
    });
    return { kind: "left_to_ops" };
  }
  // Razorpay answered the receipt with the refund it already made: a second press before its webhook landed.
  if (outcome.refundId === null) return { kind: "nothing_left" };
  await auditStatement(
    db,
    {
      surface: "ops",
      actor: written.actor,
      action: "payment.refund",
      subject: { kind: "client", id: paid.person_id },
      requestId: written.requestId,
      detail: { payment: asked.paymentId, amount, reason: asked.reason },
    },
    written.now,
  ).run();
  return { kind: "refunded", amount };
}

/**
 * The Tasks board's payment to refund, a hold let go whose refund Razorpay would not make: what is owed back in paise
 * and the Razorpay payment, for ops to refund, an erased client's included. It goes once a refund of the payment is
 * made (migration 0096's indexes).
 */
export const REFUND_OWED_LET_GO = `SELECT 'payment_to_refund' AS "group", p.id AS id, pe.id AS person_id, pe.name AS person_name,
         'let_go ' || (p.amount - p.refunded_amount) || ' ' || p.razorpay_payment_id AS detail,
         json_object('why', 'let_go', 'amount', p.amount - p.refunded_amount, 'payment', p.razorpay_payment_id) AS facts,
         h.updated_at AS since,
         NULL AS due_by, '' AS episode
    FROM payments p JOIN slot_holds h ON h.razorpay_order_id = p.razorpay_order_id
    JOIN people pe ON pe.id = h.person_id
   WHERE p.status = 'captured' AND p.appointment_id IS NULL AND h.state = 'released' AND h.refunded_at IS NULL`;

/** And a refund Razorpay failed, with nothing made since. */
export const REFUND_OWED_FAILED = `SELECT 'payment_to_refund' AS "group", p.id AS id, pe.id AS person_id, pe.name AS person_name,
         'refund_failed ' || r.amount || ' ' || p.razorpay_payment_id AS detail,
         json_object('why', 'refund_failed', 'amount', r.amount, 'payment', p.razorpay_payment_id) AS facts,
         r.updated_at AS since,
         NULL AS due_by, '' AS episode
    FROM refunds r JOIN payments p ON p.id = r.payment_id
    JOIN people pe ON pe.id = p.person_id
   WHERE r.status = 'failed' AND p.status <> 'refunded'
     AND NOT EXISTS (
       SELECT 1 FROM refunds later
        WHERE later.payment_id = r.payment_id AND ${statusIn("later.status", REFUND_NOT_FAILED)}
          AND later.created_at > r.created_at)`;
