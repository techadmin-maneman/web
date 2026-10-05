// A refund, made once however often it is asked for (docs/decisions/0100-a-refund-is-made-once.md). Each carries a
// receipt that no other refund of its payment carries, and Razorpay refuses a second refund under a receipt, so a
// refund whose answer never came can be asked for again without paying the client twice.

import type { PaymentsProvider, RefundAsked } from "../providers/payments/index.ts";
import { PaymentUnanswered } from "../providers/provider-error.ts";

/** The most calls a refund makes: asked once, and once more at once when the first gave no answer. */
export const ASKS = 2;

/** What a refund is for: each has one receipt, so each is made once. */
export type RefundFor =
  | { readonly kind: "hold"; readonly holdId: string }
  | { readonly kind: "cancel"; readonly appointmentId: string }
  | {
      readonly kind: "no_show";
      readonly why: "waived" | "charged" | "refunded on dispute";
      readonly appointmentId: string;
    };

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
  }
}

export type RefundOutcome =
  /** Made now, or by an earlier ask under the same receipt, whose refund ID we do not have. */
  | { readonly kind: "refunded"; readonly refundId: string | null }
  | { readonly kind: "refused"; readonly error: unknown }
  /** Razorpay did not say, so the refund may have been made; asking again under its receipt stays safe. */
  | { readonly kind: "unanswered"; readonly error: unknown };

/**
 * Asks for a refund, and asks once more at once if Razorpay gave no answer. A refusal after no answer is not taken
 * as one, since Razorpay may refuse a payment already refunded before it reads the receipt. Nor is one when the
 * refund was `askedBefore`, by a request whose outcome is not known.
 */
export async function askRefund(
  payments: PaymentsProvider,
  paymentId: string,
  refund: RefundAsked,
  options: { readonly askedBefore: boolean } = { askedBefore: false },
): Promise<RefundOutcome> {
  let unanswered = options.askedBefore;
  let lastError: unknown = null;
  for (let asked = 0; asked < ASKS; asked += 1) {
    try {
      return { kind: "refunded", refundId: (await payments.refund(paymentId, refund)).id };
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
 * (docs/decisions/0100-a-refund-is-made-once.md). `what` is the amount and the visit, as "Rs. 500 for visit …".
 */
export function refundLeftToOps(
  outcome: "refused" | "unanswered",
  what: string,
  paymentId: string,
  amount: number,
): string {
  if (outcome === "refused") {
    return `The refund of ${what}, failed (Razorpay payment ${paymentId}). Refund it by hand in Razorpay, once.`;
  }
  return (
    `Razorpay did not answer the refund of ${what} (payment ${paymentId}), so it may have been made. Look at the ` +
    `payment in Razorpay, and refund it by hand only if no refund of Rs. ${String(amount / 100)} is there.`
  );
}
