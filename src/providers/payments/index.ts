// Taking payment and giving it back, behind an interface (docs/decisions/0045-self-serve-booking.md), and asking
// for it by a link once a client is fitted at a consultation and fit in one visit
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). Callers use PaymentsProvider; only this file knows
// which implementation runs, and only src/providers/payments/razorpay.ts knows Razorpay. Amounts are in paise.

import type { RazorpaySettings } from "../../config/settings.ts";
import type { Logger } from "../../log.ts";
import { createRazorpay, type RazorpayPayment, type RazorpayPaymentLink } from "./razorpay.ts";
import { createStubPayments } from "./stub.ts";

/** A refund, asked for under a receipt of ours that no other refund of the payment carries. */
export interface RefundAsked {
  readonly amount: number;
  readonly notes: Record<string, string>;
  readonly receipt: string;
}

/** A payment link to make: what it asks for, our reference for it, whom it is for, and until when. */
export interface PaymentLinkRequest {
  readonly amount: number;
  /** Ours, unique to the link and shown on Razorpay's page: the reference its payment will have, "MM-2026-0841". */
  readonly reference: string;
  /** What the client reads on Razorpay's page. */
  readonly description: string;
  readonly customer: { readonly name: string; readonly contact: string };
  readonly notes: Record<string, string>;
  /** When it stops taking payment. */
  readonly closesAt: Date;
  /** Whether Razorpay texts the link, and reminders of it, to the customer; off, the link is only made. */
  readonly notify: boolean;
}

export interface PaymentsProvider {
  /** An order for Checkout to pay; its notes come back on the payment. */
  createOrder(order: { amount: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
  /** Each payment made on an order, as Razorpay holds it now: "created" while one is still being made. */
  orderPayments(orderId: string): Promise<readonly RazorpayPayment[]>;
  /**
   * Gives a payment back, in full or part, to where it came from; answers the refund's ID, or null where a refund
   * under the same receipt was made before. Throws PaymentUnanswered where it cannot say whether it was made.
   */
  refund(paymentId: string, refund: RefundAsked): Promise<{ id: string | null }>;
  /**
   * A payment link, which Razorpay texts to the customer itself where asked to. Refused for a reference Razorpay
   * already holds a link under.
   */
  createPaymentLink(link: PaymentLinkRequest): Promise<MadeLink>;
  /** The link made under our reference, if there is one: what a try whose answer never came made. */
  findPaymentLink(reference: string): Promise<MadeLink | null>;
  /** Razorpay texts a link it made to the customer again, by its ID. */
  resendPaymentLink(linkId: string): Promise<void>;
  /** A payment link as Razorpay holds it now: "paid" once paid, with the order its payment was made on. */
  paymentLink(linkId: string): Promise<RazorpayPaymentLink>;
  /** Stops a link taking payment, and Razorpay's reminders of it. Refused for a link paid, expired or cancelled. */
  cancelPaymentLink(linkId: string): Promise<void>;
}

/** A payment link Razorpay made: its ID, and the address it texted. */
export interface MadeLink {
  readonly id: string;
  readonly shortUrl: string;
}

export function createPaymentsProvider(
  provider: string | undefined,
  settings: RazorpaySettings | null,
  deps: { fetch: typeof fetch; log: Logger },
): PaymentsProvider {
  if (provider === "razorpay" && settings !== null) return createRazorpay(settings, deps);
  if (provider === "stub") return createStubPayments();
  const off = () => Promise.reject(new Error("payments are not connected here (PAYMENTS_PROVIDER is none)"));
  return {
    createOrder: off,
    orderPayments: off,
    refund: off,
    createPaymentLink: off,
    findPaymentLink: off,
    resendPaymentLink: off,
    paymentLink: off,
    cancelPaymentLink: off,
  };
}
