// Taking payment and giving it back, behind an interface (docs/decisions/0045-self-serve-booking.md). Callers use
// PaymentsProvider; only this file knows which implementation runs, and only src/providers/razorpay.ts knows
// Razorpay. Amounts are in paise.

import type { RazorpaySettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import { createRazorpay } from "./razorpay.ts";

export interface PaymentsProvider {
  /** An order for Checkout to pay; its notes come back on the payment. */
  createOrder(order: { amount: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
  /** Gives a payment back, in full or part, to where it came from. */
  refund(paymentId: string, refund: { amount: number; notes: Record<string, string> }): Promise<{ id: string }>;
}

export function createPaymentsProvider(
  provider: string | undefined,
  settings: RazorpaySettings | null,
  deps: { fetch: typeof fetch; log: Logger },
): PaymentsProvider {
  if (provider === "razorpay" && settings !== null) return createRazorpay(settings, deps);
  if (provider === "stub") return createStubPayments();
  const off = () => Promise.reject(new Error("payments are not connected here (PAYMENTS_PROVIDER is none)"));
  return { createOrder: off, refund: off };
}

/** The stub, and what it was asked, for tests to read. */
export interface StubPayments extends PaymentsProvider {
  readonly made: {
    readonly orders: { amount: number; receipt: string; notes: Record<string, string> }[];
    readonly refunds: { paymentId: string; amount: number }[];
  };
}

/** Local and test stand-in: takes no money and reaches nothing. Its IDs are unique, as a new stub answers each request. */
export function createStubPayments(): StubPayments {
  const made = {
    orders: [] as { amount: number; receipt: string; notes: Record<string, string> }[],
    refunds: [] as { paymentId: string; amount: number }[],
  };
  return {
    made,
    createOrder: (order) => {
      made.orders.push(order);
      return Promise.resolve({ id: `order_stub_${crypto.randomUUID()}` });
    },
    refund: (paymentId, refund) => {
      made.refunds.push({ paymentId, amount: refund.amount });
      return Promise.resolve({ id: `rfnd_stub_${crypto.randomUUID()}` });
    },
  };
}
