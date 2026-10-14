// A custom order refunded in full (docs/decisions/0176-custom-order-refunds.md): before its purchase order went out,
// once its supplier is late past the grace ops set, or once its piece failed its check. A client who changes their mind
// after the order has gone has nothing back. The refund is made once, under the order's own receipt
// (docs/decisions/0100-a-refund-is-made-once.md); a draft order not yet sent is cancelled with it.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { auditStatement } from "../platform/audit.ts";
import { paymentsTab, type AlertOnce } from "../platform/alerts.ts";
import type { Written } from "../platform/audit.ts";
import { askRefund, refundLeftToOps, refundReceipt } from "./refunds.ts";

export const REFUND_REASONS = ["not_ordered", "late", "failed_check"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export type CustomRefund =
  | { readonly kind: "refunded" }
  | { readonly kind: "missing" }
  | { readonly kind: "not_due" }
  | { readonly kind: "left_to_ops" };

type PaidRow = {
  number: number;
  person_id: string;
  amount: number;
  promised_on: string | null;
  razorpay_payment_id: string | null;
  refunded_at: string | null;
  refund_asked_at: string | null;
  po_id: string | null;
  po_state: string | null;
  failed_check: number;
};

/** Whether the reason given holds for the order as it stands. */
function isDue(order: PaidRow, reason: RefundReason, today: string, graceDays: number): boolean {
  const sent = order.po_state === "sent" || order.po_state === "part_received";
  if (reason === "not_ordered")
    return order.po_state === null || order.po_state === "drafted" || order.po_state === "approved";
  if (reason === "late") return sent && order.promised_on !== null && today > addDays(order.promised_on, graceDays);
  return order.failed_check === 1;
}

/** The order refunded in full for the reason given, where it holds; what came of asking Razorpay. */
export async function refundCustomOrder(
  db: D1Database,
  deps: { readonly payments: PaymentsProvider; readonly alertOnce: AlertOnce },
  asked: { readonly orderId: string; readonly reason: RefundReason; readonly graceDays: number },
  written: Written,
): Promise<CustomRefund> {
  const order = await db
    .prepare(
      `SELECT k.number, k.person_id, k.amount, k.promised_on, k.razorpay_payment_id, k.refunded_at,
         k.refund_asked_at, k.po_id,
         o.state AS po_state,
         EXISTS (SELECT 1 FROM po_lines l JOIN receipt_lines r ON r.po_line_id = l.id
                   JOIN supplier_claims c ON c.receipt_line_id = r.id
                 WHERE l.po_id = k.po_id AND l.custom_order_id = k.id AND c.reason = 'qc_failed') AS failed_check
       FROM custom_orders k LEFT JOIN purchase_orders o ON o.id = k.po_id
       WHERE k.id = ?1 AND k.state = 'paid'`,
    )
    .bind(asked.orderId)
    .first<PaidRow>();
  const paymentId = order?.razorpay_payment_id ?? null;
  if (order === null || paymentId === null) return { kind: "missing" };
  if (order.refunded_at !== null || !isDue(order, asked.reason, indiaDate(written.now), asked.graceDays)) {
    return { kind: "not_due" };
  }
  // Claimed before Razorpay is asked: a second press, or one whose answer was lost, asks as for a refund that may
  // have been made, so a refusal then is not taken as one.
  const claimed = await db
    .prepare("UPDATE custom_orders SET refund_asked_at = ?2 WHERE id = ?1 AND refund_asked_at IS NULL")
    .bind(asked.orderId, written.now.toISOString())
    .run();
  const askedBefore = order.refund_asked_at !== null || claimed.meta.changes === 0;
  const outcome = await askRefund(
    deps.payments,
    paymentId,
    {
      amount: order.amount,
      receipt: refundReceipt({ kind: "custom_order", orderId: asked.orderId }),
      notes: { custom_order_id: asked.orderId },
    },
    { askedBefore },
  );
  const number = `CU-${String(order.number).padStart(4, "0")}`;
  if (outcome.kind !== "refunded") {
    await deps.alertOnce({
      key: `custom_order_refund:${asked.orderId}`,
      message: refundLeftToOps(outcome.kind, `custom order ${number}`, paymentId, order.amount),
      link: paymentsTab(order.person_id),
    });
    return { kind: "left_to_ops" };
  }
  const at = written.now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE custom_orders SET refund_reason = ?2, razorpay_refund_id = ?3, refunded_at = ?4, updated_at = ?4
         WHERE id = ?1 AND refunded_at IS NULL`,
      )
      .bind(asked.orderId, asked.reason, outcome.refundId, at),
    db
      .prepare(
        `UPDATE purchase_orders SET state = 'cancelled', cancelled_by = ?2, cancelled_at = ?3, cancel_reason = ?4,
           updated_at = ?3
         WHERE id = ?1 AND state IN ('drafted', 'approved')`,
      )
      .bind(order.po_id, written.actor.id, at, `${number} refunded before it was sent`),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "custom_order.refund",
        subject: { kind: "client", id: order.person_id },
        requestId: written.requestId,
        detail: { custom_order: asked.orderId, reason: asked.reason, amount: order.amount },
      },
      written.now,
    ),
  ]);
  return { kind: "refunded" };
}
