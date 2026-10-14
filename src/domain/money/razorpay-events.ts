// A Razorpay event applied (docs/decisions/0044-payments-mirror.md): the payment or refund kept, the hold it paid for
// booked, the payment link it paid for settled, and ops told of what nothing here can settle. The webhook takes the
// event and queues it (src/routes/hooks/razorpay.ts); its consumer applies it here (src/queues/razorpay.ts). Razorpay
// delivers at least once and not in order, so every step is safe to apply twice.

import { z } from "zod";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import type { Logger } from "../../log.ts";
import type { PaymentsProvider } from "../../providers/payments/index.ts";
import {
  RazorpayPaymentLinkSchema,
  RazorpayPaymentSchema,
  RazorpayRefundSchema,
  type RazorpayPayment,
  type RazorpayPaymentLink,
  type RazorpayRefund,
} from "../../providers/payments/razorpay.ts";
import { bookPaidHold } from "../booking/book-paid-hold.ts";
import { holdOfLink, recordHoldLinkPaid, type LinkHold } from "../booking/visit-booking.ts";
import { paymentsTab, type AlertOnce } from "../platform/alerts.ts";
import { recordBookingConsents } from "../privacy/booking-consents.ts";
import { customOrderOfLink, customOrderPaid } from "./custom-order-links.ts";
import { cancelLinkPaidElsewhere, linkPaid } from "./payment-links-paid.ts";
import {
  keptRefund,
  otherCaptureOf,
  paymentStatusOf,
  recordPayment,
  recordRefund,
  recordRefundedPayment,
} from "./payments.ts";

/** An event as Razorpay sends it: its name, and the entities it carries. */
export const RazorpayEventSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
      refund: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
      payment_link: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
    })
    .optional(),
});
export type RazorpayEvent = z.infer<typeof RazorpayEventSchema>;

/**
 * The event claimed by its ID, in one statement, so of two deliveries at once only one is queued: whether this one
 * claimed it.
 */
export async function claimEvent(
  db: D1Database,
  event: { readonly id: string; readonly name: string; readonly at: Date },
) {
  const claimed = await db
    .prepare(
      `INSERT INTO razorpay_events (event_id, event, received_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING
       RETURNING event_id`,
    )
    .bind(event.id, event.name.slice(0, 60), event.at.toISOString())
    .first();
  return claimed !== null;
}

/** A claim let go, as when its queue would not take the event, so Razorpay's next delivery claims it again. */
export async function releaseEvent(db: D1Database, eventId: string): Promise<void> {
  await db.prepare("DELETE FROM razorpay_events WHERE event_id = ?1").bind(eventId).run();
}

/** What an event is applied with. */
export interface EventBasis {
  readonly db: D1Database;
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
  readonly log: Logger;
  readonly now: Date;
  /** The salt a payer's number is hashed with. */
  readonly hashSalt: string;
  /** The webhook's request, which the consents a payment gives are recorded under. */
  readonly requestId: string;
  /** Queues a message about a visit once its row is written. */
  readonly notify: (messageId: string) => Promise<unknown>;
}

/** Applied, or a refund of a payment not yet kept, whose event does not carry it: tried again once it is. */
export type Applied = "applied" | "not_ready";

/**
 * The link a client paid for a visit ops booked: the payment is kept on the hold the link was for, which confirms it,
 * and the hold is booked, as a payment at Checkout is. A payment Razorpay names no order for is kept as the client's,
 * and ops are told once to book or refund it.
 */
async function holdLinkPaid(
  basis: EventBasis,
  paid: { readonly hold: LinkHold; readonly link: RazorpayPaymentLink; readonly payment: RazorpayPayment },
): Promise<void> {
  const { hold, link, payment } = paid;
  const { db, hashSalt, now } = basis;
  const orderId = payment.order_id ?? link.order_id ?? null;
  if (orderId === null) {
    const notes = { hold_id: hold.id, person_id: hold.personId };
    await recordPayment({ db, payment: { ...payment, notes }, status: "captured", hashSalt, now });
    basis.log.warn("razorpay_hook_hold_link_without_order", { hold_id: hold.id });
    await basis.alertOnce({
      key: `hold_link_without_order:${hold.id}`,
      message: ALERT_WORDS.hold_link_without_order({ booking: hold.id, payment: payment.id }),
      link: paymentsTab(hold.personId),
    });
    return;
  }
  await recordHoldLinkPaid(db, { hold, payment, orderId }, hashSalt, now);
  await bookPaidHold(basis, hold.id);
  basis.log.info("razorpay_hook_hold_link_paid", { hold_id: hold.id });
}

/** A payment link paid: a custom order's, a visit ops booked's, or a one visit's. */
async function linkEvent(basis: EventBasis, link: RazorpayPaymentLink, payment: RazorpayPayment): Promise<void> {
  const { db, hashSalt, now, log } = basis;
  const hold = await holdOfLink(db, { razorpayLinkId: link.id, reference: link.reference_id ?? null });
  if (hold !== null) return holdLinkPaid(basis, { hold, link, payment });
  const customOrder = await customOrderOfLink(db, link);
  if (customOrder !== null) {
    await customOrderPaid(db, { orderId: customOrder, payment }, basis, now);
    log.info("razorpay_hook_custom_order_paid", { custom_order_id: customOrder });
    return;
  }
  const visit = await linkPaid(db, { link, payment }, hashSalt, now);
  log.info("razorpay_hook_link_paid", { ours: visit !== null });
  if (visit !== null) await cancelLinkPaidElsewhere(basis, { visit, razorpayLinkId: link.id }, now);
}

/**
 * Ops, once, of a refund Razorpay failed: the client was told their money is on its way back. The client's app says the
 * refund is being redone, and the Tasks board lists the payment until a refund of it goes through.
 */
async function tellIfFailed(basis: EventBasis, razorpayRefundId: string): Promise<void> {
  const kept = await keptRefund(basis.db, razorpayRefundId);
  if (kept?.status !== "failed") return;
  await basis.alertOnce({
    key: `refund_failed:${razorpayRefundId}`,
    message: ALERT_WORDS.refund_failed({ refund: razorpayRefundId, payment: kept.paymentId, amount: kept.amount }),
    ...(kept.personId === null ? {} : { link: paymentsTab(kept.personId) }),
  });
}

/** Ops, once, of a second payment captured on one order, which nothing here refunds by itself. */
async function tellIfPaidTwice(basis: EventBasis, payment: RazorpayPayment): Promise<void> {
  const other = await otherCaptureOf(basis.db, payment);
  if (other === null) return;
  const personId = await basis.db
    .prepare("SELECT person_id FROM payments WHERE razorpay_payment_id = ?1")
    .bind(payment.id)
    .first<string | null>("person_id");
  await basis.alertOnce({
    key: `second_capture:${payment.id}`,
    message: ALERT_WORDS.second_capture({
      order: String(payment.order_id),
      payment: payment.id,
      amount: payment.amount,
      other,
    }),
    ...(personId === null ? {} : { link: paymentsTab(personId) }),
  });
}

/**
 * Ops, of a payment made on an order its hold no longer names: Checkout left open on an order that a discount code then
 * replaced (src/domain/money/discount-code-holds.ts). Nothing books it and nothing refunds it, so ops refund it, or
 * book the visit, by hand.
 */
async function tellIfPaidOffItsOrder(basis: EventBasis, payment: RazorpayPayment, holdId: string): Promise<void> {
  if (typeof payment.order_id !== "string") return;
  const hold = await basis.db
    // A hold ops sent a payment link for takes its order from the link's paid event, which may come after this one.
    .prepare("SELECT person_id, razorpay_order_id FROM slot_holds WHERE id = ?1 AND pay_by_link = 0")
    .bind(holdId)
    .first<{ person_id: string; razorpay_order_id: string | null }>();
  if (hold === null || hold.razorpay_order_id === payment.order_id) return;
  await basis.alertOnce({
    key: `paid_off_its_order:${payment.id}`,
    message: ALERT_WORDS.paid_off_its_order({
      payment: payment.id,
      amount: payment.amount,
      order: payment.order_id,
      booking: holdId,
    }),
    link: paymentsTab(hold.person_id),
  });
}

/** The hold a payment was for, from the notes our order gave it. */
function holdOfNotes(notes: RazorpayPayment["notes"]): string | null {
  if (notes === null || notes === undefined || Array.isArray(notes)) return null;
  const holdId = notes.hold_id;
  return typeof holdId === "string" && /^[0-9a-f-]{36}$/.test(holdId) ? holdId : null;
}

/** A payment's event: the payment kept, and a capture for a hold books it and records its consents. */
async function paymentEvent(basis: EventBasis, event: string, payment: RazorpayPayment): Promise<void> {
  const { db, hashSalt, now, requestId } = basis;
  const status = paymentStatusOf(event, payment);
  if (status !== null) await recordPayment({ db, payment, status, hashSalt, now });
  if (status === "captured") await tellIfPaidTwice(basis, payment);
  const holdId = holdOfNotes(payment.notes);
  if (holdId === null) return;
  // Only the capture books it: order.paid says the same of the same payment, and the cron books a paid hold that is
  // still waiting (docs/decisions/0068-a-paid-hold-is-kept.md).
  if (event === "payment.captured") await bookPaidHold(basis, holdId);
  if (status !== "captured") return;
  await tellIfPaidOffItsOrder(basis, payment, holdId);
  // Paid for, the booking gives the photograph consents its pay step showed.
  await recordBookingConsents(db, { holdId, requestId, now });
}

/**
 * A refund event kept against its payment. A payment we never heard of is kept from the event first, without booking
 * anything for it, and ops are told. Not ready where the event does not carry that payment.
 */
async function refundEvent(basis: EventBasis, refund: RazorpayRefund, paymentEntity: unknown): Promise<Applied> {
  const { db, now } = basis;
  if (await recordRefund(db, refund, now)) {
    await tellIfFailed(basis, refund.id);
    return "applied";
  }
  if (paymentEntity === undefined) return "not_ready";
  const payment = RazorpayPaymentSchema.parse(paymentEntity);
  if (payment.id !== refund.payment_id) return "not_ready";

  const personId = await recordRefundedPayment(db, payment, basis.hashSalt, now);
  await recordRefund(db, refund, now);
  await tellIfFailed(basis, refund.id);
  await basis.alertOnce({
    key: `razorpay_refund_unheard:${payment.id}`,
    message: ALERT_WORDS.razorpay_refund_unheard({ payment: payment.id, refund: refund.id }),
    ...(personId === null ? {} : { link: paymentsTab(personId) }),
  });
  return "applied";
}

/**
 * Applies the event. An entity not of Razorpay's shape throws, so the event is tried again; one of an event nothing
 * here follows is applied as nothing.
 */
export async function applyRazorpayEvent(basis: EventBasis, { event, payload }: RazorpayEvent): Promise<Applied> {
  if (event === "payment_link.paid" && payload?.payment_link !== undefined && payload.payment !== undefined) {
    const link = RazorpayPaymentLinkSchema.parse(payload.payment_link.entity);
    await linkEvent(basis, link, RazorpayPaymentSchema.parse(payload.payment.entity));
    return "applied";
  }
  if (payload?.payment !== undefined && !event.startsWith("refund.")) {
    await paymentEvent(basis, event, RazorpayPaymentSchema.parse(payload.payment.entity));
    return "applied";
  }
  if (payload?.refund !== undefined) {
    return refundEvent(basis, RazorpayRefundSchema.parse(payload.refund.entity), payload.payment?.entity);
  }
  basis.log.info("razorpay_hook_ignored", { event: event.slice(0, 40) });
  return "applied";
}
