// Razorpay, for taking payment and giving it back (docs/decisions/0045-self-serve-booking.md).
// Only orders and refunds are made here; what happened to a payment arrives by
// the signed webhook (docs/decisions/0044-payments-mirror.md), which is the
// authority. Amounts are in paise.
//
//   POST https://api.razorpay.com/v1/orders                   { id }
//   POST https://api.razorpay.com/v1/payments/{id}/refund     { id }

import { z } from "zod";
import type { RazorpaySettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";

export interface PaymentsProvider {
  /** An order for Checkout to pay; its notes come back on the payment. */
  createOrder(order: { amount: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
  /** Gives a payment back, in full or part, to where it came from. */
  refund(paymentId: string, refund: { amount: number; notes: Record<string, string> }): Promise<{ id: string }>;
}

const API = "https://api.razorpay.com/v1";
const Created = z.object({ id: z.string() });

export class RazorpayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, description: string) {
    super(`Razorpay ${String(status)} ${code}: ${description}`);
    this.name = "RazorpayError";
    this.status = status;
    this.code = code;
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
  return { createOrder: off, refund: off };
}

function createRazorpay(settings: RazorpaySettings, deps: { fetch: typeof fetch; log: Logger }): PaymentsProvider {
  const authorization = `Basic ${btoa(`${settings.keyId}:${settings.keySecret}`)}`;

  async function post(step: string, path: string, body: object): Promise<{ id: string }> {
    const started = Date.now();
    const response = await deps.fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    deps.log.info("razorpay_call", { step, status: response.status, duration_ms: Date.now() - started });
    const answer: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (answer as { error?: { code?: string; description?: string } } | null)?.error;
      throw new RazorpayError(response.status, error?.code ?? "UNKNOWN", error?.description ?? "no description");
    }
    return Created.parse(answer);
  }

  return {
    createOrder: (order) => post("create_order", "/orders", { ...order, currency: "INR" }),
    refund: (paymentId, refund) =>
      post("refund", `/payments/${encodeURIComponent(paymentId)}/refund`, { ...refund, speed: "normal" }),
  };
}

/** The stub, and what it was asked, for tests to read. */
export interface StubPayments extends PaymentsProvider {
  readonly made: {
    readonly orders: { amount: number; receipt: string; notes: Record<string, string> }[];
    readonly refunds: { paymentId: string; amount: number }[];
  };
}

/** Local and test stand-in: takes no money and reaches nothing. */
export function createStubPayments(): StubPayments {
  const made = {
    orders: [] as { amount: number; receipt: string; notes: Record<string, string> }[],
    refunds: [] as { paymentId: string; amount: number }[],
  };
  return {
    made,
    createOrder: (order) => {
      made.orders.push(order);
      return Promise.resolve({ id: `order_stub${String(made.orders.length)}` });
    },
    refund: (paymentId, refund) => {
      made.refunds.push({ paymentId, amount: refund.amount });
      return Promise.resolve({ id: `rfnd_stub${String(made.refunds.length)}` });
    },
  };
}
