// Payments' local and test stand-in (./index.ts chooses it): it takes no money, reaches nothing, and records what
// it was asked.

import { ProviderError } from "../provider-error.ts";
import { type RazorpayPayment, type RazorpayPaymentLink } from "./razorpay.ts";
import type { PaymentLinkRequest, PaymentsProvider, MadeLink } from "./index.ts";

/** The stub, and what it was asked, for tests to read. */
export interface StubPayments extends PaymentsProvider {
  readonly made: {
    readonly orders: { amount: number; receipt: string; notes: Record<string, string> }[];
    readonly refunds: { paymentId: string; amount: number }[];
    readonly links: PaymentLinkRequest[];
    /** The links texted again, by Razorpay's ID. */
    readonly resent: string[];
    readonly cancelledLinks: string[];
  };
  /** The payments a test says were made on an order; none on an order it names nothing for. */
  readonly paymentsOn: Map<string, RazorpayPayment[]>;
  /** How a test says Razorpay holds a link now, by the link's ID; a link the stub made is otherwise unpaid. */
  readonly linksNow: Map<string, RazorpayPaymentLink>;
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
    resent: [] as string[],
    cancelledLinks: [] as string[],
  };
  const receipts = new Set<string>();
  const linksByReference = new Map<string, MadeLink>();
  const paymentsOn = new Map<string, RazorpayPayment[]>();
  const linksNow = new Map<string, RazorpayPaymentLink>();
  return {
    made,
    paymentsOn,
    linksNow,
    createOrder: (order) => {
      made.orders.push(order);
      return Promise.resolve({ id: `order_stub_${crypto.randomUUID()}` });
    },
    orderPayments: (orderId) => Promise.resolve(paymentsOn.get(orderId) ?? []),
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
    resendPaymentLink: (linkId) => {
      made.resent.push(linkId);
      return Promise.resolve();
    },
    paymentLink: (linkId) => {
      const told = linksNow.get(linkId);
      if (told !== undefined) return Promise.resolve(told);
      const madeUnder = [...linksByReference].find(([, link]) => link.id === linkId);
      if (madeUnder === undefined) {
        return Promise.reject(new ProviderError(400, "BAD_REQUEST_ERROR", "The id provided does not exist"));
      }
      return Promise.resolve({ id: linkId, status: "created", reference_id: madeUnder[0], order_id: null });
    },
    cancelPaymentLink: (linkId) => {
      made.cancelledLinks.push(linkId);
      return Promise.resolve();
    },
  };
}
