// A refund, made once however often it is asked for (docs/decisions/0100-a-refund-is-made-once.md). Each carries a
// receipt that no other refund of its payment carries, and Razorpay refuses a second refund under a receipt, so a
// refund whose answer never came can be asked for again without paying the client twice.

import type { PaymentsProvider, RefundAsked } from "../../providers/payments/index.ts";
import { PaymentUnanswered } from "../../providers/provider-error.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import { paidOutsideRazorpay } from "../../policy/upi.ts";

/** The most calls a refund makes: asked once, and once more at once when the first gave no answer. */
export const ASKS = 2;

/** What a refund is for: each has one receipt, so each is made once. */
type RefundFor =
  | { readonly kind: "hold"; readonly holdId: string }
  | { readonly kind: "cancel"; readonly appointmentId: string }
  | {
      readonly kind: "no_show";
      readonly why: "waived" | "charged" | "refunded on dispute";
      readonly appointmentId: string;
    }
  /** A payment refunded by ops (./payment-refunds.ts): the first in full or in part, `nth` the refund of it it is. */
  | { readonly kind: "payment"; readonly paymentId: string; readonly nth?: number }
  /** A custom order refunded in full (./custom-order-refunds.ts). */
  | { readonly kind: "custom_order"; readonly orderId: string };

const NO_SHOW_RECEIPTS = { waived: "nw", charged: "nc", "refunded on dispute": "nd" } as const;

/** The refund's receipt: a letter or two for what it is for, then its ID, within the 40 characters a receipt takes. */
export function refundReceipt(refund: RefundFor): string {
  switch (refund.kind) {
    case "hold":
      return `h-${refund.holdId}`;
    case "cancel":
      return `c-${refund.appointmentId}`;
    case "no_show":
      return `${NO_SHOW_RECEIPTS[refund.why]}-${refund.appointmentId}`;
    case "payment":
      // The first keeps the receipt every ops refund once had; each later part refund of the payment has its own.
      return refund.nth === undefined || refund.nth <= 1
        ? `p-${refund.paymentId}`
        : `p${String(refund.nth)}-${refund.paymentId}`;
    case "custom_order":
      return `co-${refund.orderId}`;
  }
}

export type RefundOutcome =
  /** Made now, or by an earlier ask under the same receipt, whose refund ID we do not have. */
  | { readonly kind: "refunded"; readonly refundId: string | null }
  | { readonly kind: "refused"; readonly error: unknown }
  /** Razorpay did not say, so the refund may have been made; asking again under its receipt stays safe. */
  | { readonly kind: "unanswered"; readonly error: unknown };

/** Where a refund Razorpay takes is written down, and when. */
export interface RefundRecord {
  readonly db: D1Database;
  readonly now: Date;
}

/**
 * A refund Razorpay took, kept as on its way from that moment, so what is left of the payment counts it before its
 * webhook lands; the webhook then finds the row by its refund ID and moves it on (recordRefund, ./payments.ts).
 */
async function recordAsked(record: RefundRecord, razorpayPaymentId: string, refundId: string, amount: number) {
  const at = record.now.toISOString();
  await record.db
    .prepare(
      `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, updated_at)
       SELECT ?1, p.id, ?2, ?3, 'created', ?4, ?4 FROM payments p WHERE p.razorpay_payment_id = ?5
       ON CONFLICT (razorpay_refund_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), refundId, amount, at, razorpayPaymentId)
    .run();
}

/**
 * Asks for a refund, and asks once more at once if Razorpay gave no answer. A refusal after no answer is not taken
 * as one, since Razorpay may refuse a payment already refunded before it reads the receipt. Nor is one when the
 * refund was `askedBefore`, by a request whose outcome is not known.
 */
export async function askRefund(
  payments: PaymentsProvider,
  paymentId: string,
  refund: RefundAsked,
  options: { readonly askedBefore?: boolean; readonly record: RefundRecord },
): Promise<RefundOutcome> {
  // Never through Razorpay: it holds no such payment. Ops refund it by UPI from the bank, as the refusal's alert says.
  if (paidOutsideRazorpay(paymentId)) return { kind: "refused", error: new Error("paid by UPI: refund it by UPI") };
  let unanswered = options.askedBefore ?? false;
  let lastError: unknown = null;
  for (let asked = 0; asked < ASKS; asked += 1) {
    try {
      const { id } = await payments.refund(paymentId, refund);
      if (id !== null) await recordAsked(options.record, paymentId, id, refund.amount);
      return { kind: "refunded", refundId: id };
    } catch (error) {
      lastError = error;
      if (!(error instanceof PaymentUnanswered) && !unanswered) return { kind: "refused", error };
      unanswered = true;
    }
  }
  return { kind: "unanswered", error: lastError };
}

/**
 * What ops are told to do with a refund Razorpay did not make, or would not say it made
 *. `what` is the amount and the visit, as "Rs. 500 for visit …".
 */
export function refundLeftToOps(
  outcome: "refused" | "unanswered",
  what: string,
  paymentId: string,
  amount: number,
): string {
  return ALERT_WORDS.refund_left({ outcome, what, payment: paymentId, amount });
}
