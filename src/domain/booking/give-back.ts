// Letting a hold go that cannot be kept, and refunding, once, what was paid for it.

import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { refundedMessage, type AutoRefundReason } from "../money/auto-refunds.ts";
import { askRefund, refundReceipt } from "../money/refunds.ts";
import {
  type ConfirmOptions,
  type HoldRow,
  bookingHoldRow,
  type CapturedPayment,
  refundableFor,
  type BookingBasis,
  type BookingContext,
} from "./booked-hold.ts";
import { PAYMENT_REFUNDED, statusIn } from "../../config/statuses.ts";

/** What giving a hold back did with the money. */
type GivenBack =
  | { readonly kind: "refunded"; readonly paymentId: string; readonly amount: number }
  | { readonly kind: "refunded_before"; readonly paymentId: string }
  | { readonly kind: "nothing_paid" }
  | { readonly kind: "booked" };

/** Razorpay would not refund the payment: nothing has gone back, and the hold still holds its time. */
export class RefundRefused extends Error {
  readonly paymentId: string;
  readonly amount: number;

  constructor(paymentId: string, amount: number, cause: unknown) {
    super(`Razorpay refused the refund of ${paymentId}`, { cause });
    this.paymentId = paymentId;
    this.amount = amount;
  }
}

/**
 * Razorpay did not say whether it refunded the payment, twice: the refund may have been made, and the hold still
 * holds its time. Asking again is safe, under the hold's receipt (src/domain/money/refunds.ts).
 */
export class RefundUnanswered extends Error {
  readonly paymentId: string;
  readonly amount: number;

  constructor(paymentId: string, amount: number, cause: unknown) {
    super(`Razorpay did not answer the refund of ${paymentId}`, { cause });
    this.paymentId = paymentId;
    this.amount = amount;
  }
}

/**
 * Lets a hold go, and refunds, once, what is left of any payment taken for it. Says what it did with the money; throws
 * RefundRefused, or RefundUnanswered, and keeps the hold, when Razorpay will not refund it or will not say whether it
 * did. `alongside` is written in the same batch as the hold is let go, such as ops' audit entry; `ifRefunded` is
 * written in that batch only when this call made the refund.
 */
export async function giveBack(
  basis: BookingBasis,
  holdId: string,
  reason: string,
  written: {
    readonly alongside?: readonly D1PreparedStatement[];
    readonly ifRefunded?: readonly D1PreparedStatement[];
  } = {},
): Promise<GivenBack> {
  const { db, payments, now } = basis;
  const { alongside = [], ifRefunded = [] } = written;
  const hold = await bookingHoldRow(db, holdId);
  if (hold === null) throw new Error("no such hold to give back");
  if (hold.state === "booked") return { kind: "booked" };
  const payment = await refundableFor(db, hold.razorpay_order_id);
  const given: GivenBack =
    payment === null
      ? await nothingToRefund(db, hold.razorpay_order_id)
      : await refundOnce(db, payments, hold.id, payment, now, reason);
  await db.batch([
    db.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(hold.id),
    db
      .prepare("UPDATE slot_holds SET state = 'released', updated_at = ?1 WHERE id = ?2 AND state = 'held'")
      .bind(now.toISOString(), hold.id),
    ...alongside,
    ...(given.kind === "refunded" ? ifRefunded : []),
  ]);
  return given;
}

/** Each reason as Razorpay's notes on the refund give it. */
export const AUTO_REFUND_NOTES: Readonly<Record<AutoRefundReason, string>> = {
  lapsed: "the hold had lapsed",
  not_movable: "the visit could no longer be moved",
};

/** Marks a hold as refunded by the booking itself, which ops read on the client's Visits tab. */
export const autoRefundMarked = (db: D1Database, holdId: string, reason: AutoRefundReason): D1PreparedStatement =>
  db.prepare("UPDATE slot_holds SET auto_refund_reason = ?2 WHERE id = ?1").bind(holdId, reason);

/**
 * Lets go a hold the booking could not keep: one paid after it lapsed, or a move whose visit has begun. A payment
 * refunded here is marked as refunded by the booking itself, and the client is told, both in the batch that lets the
 * hold go.
 */
export async function giveBackUnkept(
  context: BookingContext,
  hold: HoldRow,
  reason: AutoRefundReason,
): Promise<GivenBack> {
  const { db, now } = context;
  const message = refundedMessage(db, { personId: hold.person_id, holdId: hold.id, now });
  const given = await giveBack(context, hold.id, AUTO_REFUND_NOTES[reason], {
    ifRefunded: [autoRefundMarked(db, hold.id, reason), message.statement],
  });
  if (given.kind === "refunded") await tellOfRefund(message.id, context);
  return given;
}

/** Queues the client's message of a refund. One the queue refuses is in the outbox, and the sweeper sends it. */
async function tellOfRefund(messageId: string, options: ConfirmOptions): Promise<void> {
  try {
    await options.notify?.(messageId);
  } catch (error) {
    options.log.warn("refund_message_not_queued", { message_id: messageId, error });
  }
}

/** What letting go a hold with no captured payment did with the money: nothing, or it was refunded before, by ops. */
async function nothingToRefund(db: D1Database, orderId: string | null): Promise<GivenBack> {
  if (orderId === null) return { kind: "nothing_paid" };
  const refunded = await db
    .prepare(
      `SELECT razorpay_payment_id FROM payments
       WHERE razorpay_order_id = ?1 AND ${statusIn("status", PAYMENT_REFUNDED)} ORDER BY created_at LIMIT 1`,
    )
    .bind(orderId)
    .first<{ razorpay_payment_id: string }>();
  if (refunded === null) return { kind: "nothing_paid" };
  return { kind: "refunded_before", paymentId: refunded.razorpay_payment_id };
}

async function refundOnce(
  db: D1Database,
  payments: PaymentsProvider,
  holdId: string,
  payment: CapturedPayment,
  now: Date,
  reason: string,
): Promise<GivenBack> {
  // The refund is claimed on the hold before it is asked for, so a repeated message cannot ask twice.
  const claimed = await db
    .prepare("UPDATE slot_holds SET refunded_at = ?1 WHERE id = ?2 AND refunded_at IS NULL RETURNING id")
    .bind(now.toISOString(), holdId)
    .first();
  if (claimed === null) return { kind: "refunded_before", paymentId: payment.razorpay_payment_id };
  const asked = await askRefund(payments, payment.razorpay_payment_id, {
    amount: payment.amount,
    notes: { hold_id: holdId, reason },
    receipt: refundReceipt({ kind: "hold", holdId }),
  });
  if (asked.kind === "refunded") {
    return { kind: "refunded", paymentId: payment.razorpay_payment_id, amount: payment.amount };
  }
  // Let go, so the refund can be asked for again: its receipt keeps Razorpay from making it twice.
  await db.prepare("UPDATE slot_holds SET refunded_at = NULL WHERE id = ?1").bind(holdId).run();
  if (asked.kind === "refused") throw new RefundRefused(payment.razorpay_payment_id, payment.amount, asked.error);
  throw new RefundUnanswered(payment.razorpay_payment_id, payment.amount, asked.error);
}
