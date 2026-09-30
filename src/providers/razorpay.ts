// Razorpay, for taking payment and giving it back (docs/decisions/0045-self-serve-booking.md), and what its
// webhook carries. Only orders and refunds are made here; what happened to a payment arrives by the signed
// webhook (docs/decisions/0044-payments-mirror.md), which is the authority. Amounts are in paise. Only
// src/providers/payments.ts chooses this client.
//
//   POST https://api.razorpay.com/v1/orders                   { id }
//   POST https://api.razorpay.com/v1/payments/{id}/refund     { id }; a receipt used before on the payment is
//        refused as "Duplicate receipt found for this refund request.", Razorpay's idempotency for refunds
//        (https://razorpay.com/docs/api/refunds/create-normal/)

import { z } from "zod";
import type { RazorpaySettings } from "../config/settings.ts";
import { saltedHash, secretsMatch } from "../lib/hash.ts";
import type { Logger } from "../log.ts";
import { PaymentUnanswered, type PaymentsProvider } from "./payments.ts";

/** Whether a webhook body is Razorpay's: X-Razorpay-Signature is the HMAC-SHA256 of the raw body under the secret. */
export async function signedByRazorpay(secret: string, body: string, signature: string): Promise<boolean> {
  return secretsMatch(signature, await saltedHash(secret, body));
}

/** The fields of Razorpay's payment entity, as its webhook carries it, that the mirror reads. */
export const RazorpayPaymentSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  order_id: z.string().nullish(),
  method: z.string().nullish(),
  vpa: z.string().nullish(),
  contact: z.string().nullish(),
  card: z.object({ network: z.string().nullish() }).nullish(),
  /** An object of our order's notes; Razorpay sends [] for none. */
  notes: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish(),
  /** Unix seconds. */
  created_at: z.number(),
});
export type RazorpayPayment = z.infer<typeof RazorpayPaymentSchema>;

/** The fields of Razorpay's refund entity that the mirror reads. */
export const RazorpayRefundSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: z.number(),
  status: z.string(),
  speed_processed: z.string().nullish(),
  speed_requested: z.string().nullish(),
  /** Unix seconds. */
  created_at: z.number(),
});
export type RazorpayRefund = z.infer<typeof RazorpayRefundSchema>;

const API = "https://api.razorpay.com/v1";
/** Razorpay's refusal of a refund under a receipt a refund of the payment already carries. */
const DUPLICATE_RECEIPT = "Duplicate receipt found for this refund request.";
const Created = z.object({ id: z.string() });
/** Razorpay's reason for a refusal, as much of it as it gave. */
const Refused = z.object({
  error: z.object({
    code: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
  }),
});

export class RazorpayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly description: string;

  constructor(status: number, code: string, description: string) {
    super(`Razorpay ${String(status)} ${code}: ${description}`);
    this.name = "RazorpayError";
    this.status = status;
    this.code = code;
    this.description = description;
  }
}

export function createRazorpay(
  settings: RazorpaySettings,
  deps: { fetch: typeof fetch; log: Logger },
): PaymentsProvider {
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
      const error = Refused.safeParse(answer).data?.error;
      throw new RazorpayError(response.status, error?.code ?? "UNKNOWN", error?.description ?? "no description");
    }
    return Created.parse(answer);
  }

  return {
    createOrder: (order) => post("create_order", "/orders", { ...order, currency: "INR" }),
    // Only a refusal Razorpay gave in words is one; a timeout, a failure of its own or an answer we cannot read
    // leaves the refund made or not.
    refund: async (paymentId, refund) => {
      try {
        return await post("refund", `/payments/${encodeURIComponent(paymentId)}/refund`, {
          ...refund,
          speed: "normal",
        });
      } catch (error) {
        if (!(error instanceof RazorpayError) || error.status >= 500) throw new PaymentUnanswered("refund", error);
        if (error.description === DUPLICATE_RECEIPT) return { id: null };
        throw error;
      }
    },
  };
}
