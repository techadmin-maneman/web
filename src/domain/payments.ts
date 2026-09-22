// Payments, following Razorpay's signed webhook events
// (docs/decisions/0044-payments-mirror.md). Razorpay is the record of what
// was paid and refunded. Events arrive at least once and in any order, so a
// payment's state only ever moves forward, and each refund is kept once.
//
// No card data is kept. A UPI handle is kept only as a keyed hash, which the
// fraud rules compare (P2-M3); it is never shown.

import { saltedHash } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { toE164 } from "../lib/mobile.ts";

export type PaymentStatus = "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";

/** How far along each state is. A later event with an earlier state changes nothing. recordPayment's SQL repeats it. */
const RANK: Readonly<Record<PaymentStatus, number>> = {
  failed: 0,
  authorized: 1,
  captured: 2,
  partially_refunded: 3,
  refunded: 4,
};

/** The fields of Razorpay's payment entity the mirror reads. */
export interface RazorpayPayment {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly order_id?: string | null;
  readonly method?: string | null;
  readonly vpa?: string | null;
  readonly contact?: string | null;
  readonly card?: { readonly network?: string | null } | null;
  readonly notes?: Record<string, unknown> | unknown[] | null;
  /** Unix seconds. */
  readonly created_at: number;
}

export interface RazorpayRefund {
  readonly id: string;
  readonly payment_id: string;
  readonly amount: number;
  readonly status: string;
  readonly speed_processed?: string | null;
  readonly speed_requested?: string | null;
  readonly created_at: number;
}

/** A payment event's state: from the event's name where it says, else from the payment. */
export function paymentStatusOf(event: string, payment: RazorpayPayment): PaymentStatus | null {
  if (event === "payment.captured" || event === "order.paid") return "captured";
  if (event === "payment.authorized") return "authorized";
  if (event === "payment.failed") return "failed";
  return payment.status === "captured" || payment.status === "authorized" || payment.status === "failed"
    ? payment.status
    : null;
}

/** Writes a payment event: the payment, if new, and its state, if the event moves it forward. */
export async function recordPayment(
  db: D1Database,
  payment: RazorpayPayment,
  status: PaymentStatus,
  hashSalt: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const notes =
    payment.notes !== null && payment.notes !== undefined && !Array.isArray(payment.notes) ? payment.notes : {};
  const personId = await personOf(db, notes.person_id, payment.contact ?? null);
  const appointmentId = await appointmentOf(db, notes.appointment_id);
  const vpa = payment.vpa ?? null;
  const vpaHash = vpa === null ? null : await saltedHash(hashSalt, vpa.trim().toLowerCase());

  await db
    .prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_order_id, razorpay_payment_id, amount, currency,
         method, vpa_hash, card_network, status, captured_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT (razorpay_payment_id) DO UPDATE SET
         person_id = COALESCE(payments.person_id, excluded.person_id),
         appointment_id = COALESCE(payments.appointment_id, excluded.appointment_id),
         razorpay_order_id = COALESCE(payments.razorpay_order_id, excluded.razorpay_order_id),
         method = COALESCE(excluded.method, payments.method),
         vpa_hash = COALESCE(excluded.vpa_hash, payments.vpa_hash),
         card_network = COALESCE(excluded.card_network, payments.card_network),
         status = CASE WHEN ?15 > (CASE payments.status
             WHEN 'failed' THEN 0 WHEN 'authorized' THEN 1 WHEN 'captured' THEN 2
             WHEN 'partially_refunded' THEN 3 ELSE 4 END)
           THEN excluded.status ELSE payments.status END,
         captured_at = COALESCE(payments.captured_at, excluded.captured_at),
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      personId,
      appointmentId,
      payment.order_id ?? null,
      payment.id,
      payment.amount,
      payment.currency,
      payment.method ?? null,
      vpaHash,
      payment.card?.network ?? null,
      status,
      status === "captured" ? at : null,
      new Date(payment.created_at * 1000).toISOString(),
      at,
      RANK[status],
    )
    .run();
  if (status === "captured") await giveReference(db, payment.id, now);
}

/**
 * A captured payment's reference, "MM-2026-0841": the next number of its India
 * year. One statement, so two captures at once cannot take the same number.
 */
async function giveReference(db: D1Database, razorpayPaymentId: string, now: Date): Promise<void> {
  const year = Number(indiaDate(now).slice(0, 4));
  const next = "(SELECT COALESCE(MAX(reference_number), 0) + 1 FROM payments WHERE reference_year = ?2)";
  await db
    .prepare(
      `UPDATE payments SET reference_year = ?2, reference_number = ${next},
         reference = 'MM-' || ?3 || '-' || printf('%04d', ${next})
       WHERE razorpay_payment_id = ?1 AND reference IS NULL`,
    )
    // The year again as text: D1 binds a number as a decimal, which would print "2026.0".
    .bind(razorpayPaymentId, year, String(year))
    .run();
}

/** Writes a refund event, then the payment's refunded total and state from its processed refunds. */
export async function recordRefund(db: D1Database, refund: RazorpayRefund, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const payment = await db
    .prepare("SELECT id, amount FROM payments WHERE razorpay_payment_id = ?1")
    .bind(refund.payment_id)
    .first<{ id: string; amount: number }>();
  // A refund of a payment we have not heard of yet: Razorpay sends it again, and the payment comes first.
  if (payment === null) return false;

  const status = refund.status === "processed" ? "processed" : refund.status === "failed" ? "failed" : "created";
  await db.batch([
    db
      .prepare(
        `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, speed, created_at, processed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (razorpay_refund_id) DO UPDATE SET
           status = CASE WHEN refunds.status = 'processed' THEN refunds.status ELSE excluded.status END,
           speed = COALESCE(excluded.speed, refunds.speed),
           processed_at = COALESCE(refunds.processed_at, excluded.processed_at),
           updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        payment.id,
        refund.id,
        refund.amount,
        status,
        refund.speed_processed ?? refund.speed_requested ?? null,
        new Date(refund.created_at * 1000).toISOString(),
        status === "processed" ? at : null,
        at,
      ),
    db
      .prepare(
        `UPDATE payments SET
           refunded_amount = (SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE payment_id = ?1 AND status = 'processed'),
           status = CASE
             WHEN (SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE payment_id = ?1 AND status = 'processed') >= ?2
               THEN 'refunded'
             WHEN (SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE payment_id = ?1 AND status = 'processed') > 0
               THEN 'partially_refunded'
             ELSE status END,
           updated_at = ?3
         WHERE id = ?1`,
      )
      .bind(payment.id, payment.amount, at),
  ]);
  return true;
}

/** Our person: named in our order's notes, else found by the mobile number paid with. Never made up. */
async function personOf(db: D1Database, notedId: unknown, contact: string | null): Promise<string | null> {
  if (typeof notedId === "string") {
    const noted = await db.prepare("SELECT id FROM people WHERE id = ?1").bind(notedId).first<{ id: string }>();
    if (noted !== null) return noted.id;
  }
  const mobile = contact === null ? null : toE164(contact);
  if (mobile === null) return null;
  const found = await db.prepare("SELECT id FROM people WHERE mobile_e164 = ?1").bind(mobile).first<{ id: string }>();
  return found?.id ?? null;
}

async function appointmentOf(db: D1Database, notedId: unknown): Promise<string | null> {
  if (typeof notedId !== "string") return null;
  const found = await db.prepare("SELECT id FROM appointments WHERE id = ?1").bind(notedId).first<{ id: string }>();
  return found?.id ?? null;
}
