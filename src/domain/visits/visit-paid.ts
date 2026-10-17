// What a client paid for one of their visits, which the visit's own page says beside its receipt.

import { PAYMENT_HELD, statusIn } from "../../config/statuses.ts";

export interface VisitPaid {
  /** In paise, GST included. */
  readonly amount: number;
  /** The payment whose receipt Books has, for GET /api/payments/{id}/receipt; null until it has one. */
  readonly receipt: string | null;
}

/** The visit's own payment, taken and not given back; null where nothing was paid. */
export async function paidFor(db: D1Database, visitId: string): Promise<VisitPaid | null> {
  const row = await db
    .prepare(
      `SELECT p.id, p.amount, p.books_payment_id FROM payments p
       WHERE p.appointment_id = ?1 AND p.kind = 'visit' AND ${statusIn("p.status", PAYMENT_HELD)}
       ORDER BY p.captured_at LIMIT 1`,
    )
    .bind(visitId)
    .first<{ id: string; amount: number; books_payment_id: string | null }>();
  return row === null ? null : { amount: row.amount, receipt: row.books_payment_id === null ? null : row.id };
}
