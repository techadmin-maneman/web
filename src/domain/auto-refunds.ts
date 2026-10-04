// Holds a booking refunded by itself (src/domain/bookings.ts): paid after the hold lapsed, or a move whose visit the
// technician had begun. The client is told on WhatsApp in the batch that lets the hold go, and ops read each on the
// client's Visits tab.

import { VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";

/** Why a booking refunded its hold by itself. */
export const AUTO_REFUND_REASONS = ["lapsed", "not_movable"] as const;
export type AutoRefundReason = (typeof AUTO_REFUND_REASONS)[number];

/** A hold refunded by the booking itself, as the console lists it. */
export interface AutoRefund {
  readonly holdId: string;
  readonly type: VisitType;
  readonly serviceName: string;
  /** India's day the visit was to be on. */
  readonly date: string;
  /** In paise, GST included: what Razorpay took, all of which went back; null where the payment is not on record. */
  readonly amount: number | null;
  readonly reason: AutoRefundReason;
  readonly refundedAt: string;
}

interface AutoRefundRow {
  id: string;
  type: VisitType;
  service_name: string | null;
  date: string;
  amount: number | null;
  auto_refund_reason: AutoRefundReason;
  refunded_at: string;
}

/** The client's holds the booking refunded by itself, the latest refund first. */
export async function autoRefundsOf(db: D1Database, personId: string): Promise<AutoRefund[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.type, s.name AS service_name, h.date, h.auto_refund_reason, h.refunded_at,
              (SELECT p.amount FROM payments p WHERE p.razorpay_order_id = h.razorpay_order_id
                 AND p.status IN ('captured', 'refunded', 'partially_refunded') ORDER BY p.created_at LIMIT 1) AS amount
       FROM slot_holds h LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
       WHERE h.person_id = ?1 AND h.auto_refund_reason IS NOT NULL AND h.refunded_at IS NOT NULL
       ORDER BY h.refunded_at DESC`,
    )
    .bind(personId)
    .all<AutoRefundRow>();
  return results.map((row) => ({
    holdId: row.id,
    type: row.type,
    serviceName: row.service_name ?? VISIT_TYPE_NAMES[row.type],
    date: row.date,
    amount: row.amount,
    reason: row.auto_refund_reason,
    refundedAt: row.refunded_at,
  }));
}
