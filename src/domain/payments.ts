// Payments, following Razorpay's signed webhook events
// (docs/decisions/0044-payments-mirror.md). Razorpay is the record of what
// was paid and refunded. Events arrive at least once and in any order, so a
// payment's state only ever moves forward, and each refund is kept once.
//
// No card data is kept. A UPI handle is kept only as a keyed hash, which the
// fraud rules compare; it is never shown.

import { saltedHash } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { toE164 } from "../lib/mobile.ts";
import type { RazorpayPayment, RazorpayRefund } from "../providers/payments/razorpay.ts";
import { confirmPaidHold } from "./bookings.ts";

type PaymentStatus = "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";

/** How far along each state is. A later event with an earlier state changes nothing. recordPayment's SQL repeats it. */
const RANK: Readonly<Record<PaymentStatus, number>> = {
  failed: 0,
  authorized: 1,
  captured: 2,
  partially_refunded: 3,
  refunded: 4,
};

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
  await writePayment(db, payment, status, hashSalt, now);
  if (status !== "captured") return;
  await giveReference(db, payment.id, holdIdOf(payment), now);
  // The hold it paid for keeps its time from here until it is booked or refunded (src/domain/bookings.ts).
  const madeAt = new Date(payment.created_at * 1000).toISOString();
  if (typeof payment.order_id === "string") await confirmPaidHold(db, payment.order_id, madeAt, now).run();
}

/**
 * A payment first heard of in its refund's event, as when ops refund one whose own events never reached us. It is
 * kept as it stood before the refund, with our reference if it was captured, but its hold is not confirmed, so no
 * visit is booked for money that has gone back. Our person for it, if we know them.
 */
export async function recordRefundedPayment(
  db: D1Database,
  payment: RazorpayPayment,
  hashSalt: string,
  now: Date,
): Promise<string | null> {
  const status = payment.captured === false ? "authorized" : "captured";
  const personId = await writePayment(db, payment, status, hashSalt, now);
  if (status === "captured") await giveReference(db, payment.id, holdIdOf(payment), now);
  return personId;
}

/** The notes we put on a payment we asked for; none on one made elsewhere. */
function notesOf(payment: RazorpayPayment): Record<string, unknown> {
  return payment.notes !== null && payment.notes !== undefined && !Array.isArray(payment.notes) ? payment.notes : {};
}

/** The hold the payment was asked for, from its notes. */
function holdIdOf(payment: RazorpayPayment): string | null {
  const holdId = notesOf(payment).hold_id;
  return typeof holdId === "string" ? holdId : null;
}

/** The payment, if new, and its state, if `status` moves it forward. Our person for it, if we know them. */
async function writePayment(
  db: D1Database,
  payment: RazorpayPayment,
  status: PaymentStatus,
  hashSalt: string,
  now: Date,
): Promise<string | null> {
  const at = now.toISOString();
  const notes = notesOf(payment);
  const personId = await personOf(db, notes.person_id, payment.contact ?? null);
  const appointmentId = await appointmentOf(db, notes.appointment_id);
  const vpa = payment.vpa ?? null;
  const vpaHash = vpa === null ? null : await saltedHash(hashSalt, vpa.trim().toLowerCase());
  /** Razorpay's own time for the payment, which says whether it came in time for its hold. */
  const madeAt = new Date(payment.created_at * 1000).toISOString();

  // The split before GST is the hold's, whose price is what Razorpay was asked to charge: only when the amounts
  // agree, since a payment for any other figure was not priced by the hold.
  const heldPrice = "FROM slot_holds WHERE razorpay_order_id = ?4 AND amount = ?6";
  await db
    .prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_order_id, razorpay_payment_id, amount, currency,
         method, vpa_hash, card_network, status, captured_at, created_at, updated_at, amount_ex_gst, gst_percent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
         (SELECT amount_ex_gst ${heldPrice}), (SELECT gst_percent ${heldPrice}))
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
         amount_ex_gst = COALESCE(payments.amount_ex_gst, excluded.amount_ex_gst),
         gst_percent = COALESCE(payments.gst_percent, excluded.gst_percent),
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
      madeAt,
      at,
      RANK[status],
    )
    .run();
  return personId;
}

/**
 * The next number of the year ?2. Payments and payment links, a one visit's and a held visit's, number from one
 * series, so a link can carry the reference its payment will have.
 */
const NEXT_NUMBER = `(SELECT COALESCE(MAX(number), 0) + 1 FROM (
  SELECT reference_number AS number FROM payments WHERE reference_year = ?2
  UNION ALL SELECT reference_number FROM payment_links WHERE reference_year = ?2
  UNION ALL SELECT reference_number FROM slot_holds WHERE reference_year = ?2))`;

/** "MM-2026-0841": the year ?3, as text, and the next number. */
const NEXT_REFERENCE = `'MM-' || ?3 || '-' || printf('%04d', ${NEXT_NUMBER})`;

/** The year of India's date, as a number and again as text: D1 binds a number as a decimal, which prints "2026.0". */
function referenceYear(now: Date): [number, string] {
  const year = Number(indiaDate(now).slice(0, 4));
  return [year, String(year)];
}

/**
 * A captured payment's reference: the one its link was made under, which the client read on Razorpay's page, else the
 * next of its India year. Each is one statement, so two captures at once cannot take the same number. The link is the
 * visit's, or that of the hold named in the payment's notes, and only where the amounts agree.
 */
async function giveReference(
  db: D1Database,
  razorpayPaymentId: string,
  holdId: string | null,
  now: Date,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE payments SET (reference_year, reference_number, reference) = (
           SELECT l.reference_year, l.reference_number, l.reference FROM payment_links l
           WHERE l.appointment_id = payments.appointment_id AND l.amount = payments.amount
             AND NOT EXISTS (SELECT 1 FROM payments taken WHERE taken.reference = l.reference))
         WHERE razorpay_payment_id = ?1 AND reference IS NULL`,
      )
      .bind(razorpayPaymentId),
    db
      .prepare(
        `UPDATE payments SET (reference_year, reference_number, reference) = (
           SELECT h.reference_year, h.reference_number, h.reference FROM slot_holds h
           WHERE h.id = ?2 AND h.reference IS NOT NULL AND h.amount = payments.amount
             AND NOT EXISTS (SELECT 1 FROM payments taken WHERE taken.reference = h.reference))
         WHERE razorpay_payment_id = ?1 AND reference IS NULL`,
      )
      .bind(razorpayPaymentId, holdId),
    db
      .prepare(
        `UPDATE payments SET reference_year = ?2, reference_number = ${NEXT_NUMBER}, reference = ${NEXT_REFERENCE}
         WHERE razorpay_payment_id = ?1 AND reference IS NULL`,
      )
      .bind(razorpayPaymentId, ...referenceYear(now)),
  ]);
}

/** Gives a one visit's payment link just written the next reference of its India year, which its payment then takes. */
export function referenceLink(db: D1Database, linkId: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE payment_links SET reference_year = ?2, reference_number = ${NEXT_NUMBER}, reference = ${NEXT_REFERENCE}
       WHERE id = ?1 AND reference IS NULL`,
    )
    .bind(linkId, ...referenceYear(now));
}

/** Gives the hold of a visit ops booked the next reference of its India year, for the link they send the client. */
export function referenceHold(db: D1Database, holdId: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE slot_holds SET reference_year = ?2, reference_number = ${NEXT_NUMBER}, reference = ${NEXT_REFERENCE}
       WHERE id = ?1 AND reference IS NULL`,
    )
    .bind(holdId, ...referenceYear(now));
}

/**
 * Our refund's state from Razorpay's: processed and failed as they are, anything earlier still created. Created ranks
 * below both, so an event that arrives late never takes a refund back to created, and a processed one stays processed.
 */
function refundStateOf(status: string): "processed" | "failed" | "created" {
  if (status === "processed" || status === "failed") return status;
  return "created";
}

/**
 * Writes a refund event, then the payment's refunded total and state from its processed refunds. False, with nothing
 * written, for a refund of a payment we have not heard of.
 */
export async function recordRefund(db: D1Database, refund: RazorpayRefund, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const payment = await db
    .prepare("SELECT id, amount FROM payments WHERE razorpay_payment_id = ?1")
    .bind(refund.payment_id)
    .first<{ id: string; amount: number }>();
  if (payment === null) return false;

  const status = refundStateOf(refund.status);
  await db.batch([
    db
      .prepare(
        `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, speed, created_at, processed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (razorpay_refund_id) DO UPDATE SET
           status = CASE WHEN refunds.status = 'processed' OR excluded.status = 'created' THEN refunds.status
                         ELSE excluded.status END,
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

/** A refund as we keep it, after its latest event: what ops are told of one that failed. */
interface KeptRefund {
  readonly status: "created" | "processed" | "failed";
  readonly amount: number;
  readonly paymentId: string;
  readonly personId: string | null;
}

export async function keptRefund(db: D1Database, razorpayRefundId: string): Promise<KeptRefund | null> {
  return db
    .prepare(
      `SELECT r.status, r.amount, p.razorpay_payment_id AS paymentId, p.person_id AS personId
       FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.razorpay_refund_id = ?1`,
    )
    .bind(razorpayRefundId)
    .first<KeptRefund>();
}

/**
 * Another payment captured on the same order: a client who paid twice, a late authorisation after a retry at
 * Checkout. Null when this is the order's only one.
 */
export async function otherCaptureOf(db: D1Database, payment: RazorpayPayment): Promise<string | null> {
  if (typeof payment.order_id !== "string") return null;
  return db
    .prepare(
      `SELECT razorpay_payment_id FROM payments
       WHERE razorpay_order_id = ?1 AND razorpay_payment_id <> ?2
         AND status IN ('captured', 'partially_refunded', 'refunded')
       ORDER BY created_at LIMIT 1`,
    )
    .bind(payment.order_id, payment.id)
    .first<string>("razorpay_payment_id");
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
