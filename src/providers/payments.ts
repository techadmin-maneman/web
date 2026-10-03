// Taking payment and giving it back, behind an interface (docs/decisions/0045-self-serve-booking.md), and asking
// for it by a link once a client is fitted at a consultation and fit in one visit
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). Callers use PaymentsProvider; only this file knows
// which implementation runs, and only src/providers/razorpay.ts knows Razorpay. Amounts are in paise.

import type { RazorpaySettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import { ProviderError } from "./provider-error.ts";
import { createRazorpay } from "./razorpay.ts";

/** A refund, asked for under a receipt of ours that no other refund of the payment carries. */
export interface RefundAsked {
  readonly amount: number;
  readonly notes: Record<string, string>;
  readonly receipt: string;
}

/** A payment link to make: what it asks for, our reference for it, and whom Razorpay texts it to. */
export interface PaymentLinkRequest {
  readonly amount: number;
  /**
   * Ours, unique to the link, and shown on Razorpay's page: a one visit's is the reference its payment will have, and
   * a visit ops booked has the hold it waits on.
   */
  readonly reference: string;
  /** What the client reads on Razorpay's page. */
  readonly description: string;
  readonly customer: { readonly name: string; readonly contact: string };
  readonly notes: Record<string, string>;
  /** When it stops taking payment; left out, it stays open. */
  readonly closesAt?: Date;
}

export interface PaymentsProvider {
  /** An order for Checkout to pay; its notes come back on the payment. */
  createOrder(order: { amount: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
  /**
   * Gives a payment back, in full or part, to where it came from; answers the refund's ID, or null where a refund
   * under the same receipt was made before. Throws PaymentUnanswered where it cannot say whether it was made.
   */
  refund(paymentId: string, refund: RefundAsked): Promise<{ id: string | null }>;
  /**
   * A payment link, which Razorpay texts to the customer itself. Refused for a reference Razorpay already holds a
   * link under.
   */
  createPaymentLink(link: PaymentLinkRequest): Promise<MadeLink>;
  /** The link made under our reference, if there is one: what a try whose answer never came made. */
  findPaymentLink(reference: string): Promise<MadeLink | null>;
}

/** A payment link Razorpay made: its ID, and the address it texted. */
export interface MadeLink {
  readonly id: string;
  readonly shortUrl: string;
}

/**
 * The payment provider gave no answer it could be held to, a timeout or its own failure, so a refund may or may not
 * have been made. Asking again under the same receipt is safe: a second refund under it is refused.
 */
export class PaymentUnanswered extends Error {
  constructor(step: string, cause: unknown) {
    super(`the payment provider did not answer the ${step}`, { cause });
    this.name = "PaymentUnanswered";
  }
}

export function createPaymentsProvider(
  provider: string | undefined,
  settings: RazorpaySettings | null,
  deps: { fetch: typeof fetch; log: Logger },
): PaymentsProvider {
  if (provider === "razorpay" && settings !== null) return createRazorpay(settings, deps);
  if (provider === "stub") return createStubPayments();
  const off = () => Promise.reject(new Error("payments are not connected here (PAYMENTS_PROVIDER is none)"));
  return { createOrder: off, refund: off, createPaymentLink: off, findPaymentLink: off };
}

/** The stub, and what it was asked, for tests to read. */
export interface StubPayments extends PaymentsProvider {
  readonly made: {
    readonly orders: { amount: number; receipt: string; notes: Record<string, string> }[];
    readonly refunds: { paymentId: string; amount: number }[];
    readonly links: PaymentLinkRequest[];
  };
}

/**
 * Local and test stand-in: takes no money and reaches nothing. Its IDs are unique, as a new stub answers each request.
 * As Razorpay does, it makes no second refund of a payment under the same receipt, and refuses a second link under a
 * reference it already holds one under.
 */
export function createStubPayments(): StubPayments {
  const made = {
    orders: [] as { amount: number; receipt: string; notes: Record<string, string> }[],
    refunds: [] as { paymentId: string; amount: number }[],
    links: [] as PaymentLinkRequest[],
  };
  const receipts = new Set<string>();
  const linksByReference = new Map<string, MadeLink>();
  return {
    made,
    createOrder: (order) => {
      made.orders.push(order);
      return Promise.resolve({ id: `order_stub_${crypto.randomUUID()}` });
    },
    refund: (paymentId, refund) => {
      const receipt = `${paymentId} ${refund.receipt}`;
      if (receipts.has(receipt)) return Promise.resolve({ id: null });
      receipts.add(receipt);
      made.refunds.push({ paymentId, amount: refund.amount });
      return Promise.resolve({ id: `rfnd_stub_${crypto.randomUUID()}` });
    },
    createPaymentLink: (link) => {
      if (linksByReference.has(link.reference)) {
        return Promise.reject(new ProviderError(400, "BAD_REQUEST_ERROR", "reference_id already exists"));
      }
      made.links.push(link);
      const id = `plink_stub_${crypto.randomUUID()}`;
      const madeLink = { id, shortUrl: `https://rzp.io/i/${id}` };
      linksByReference.set(link.reference, madeLink);
      return Promise.resolve(madeLink);
    },
    findPaymentLink: (reference) => Promise.resolve(linksByReference.get(reference) ?? null),
  };
}
