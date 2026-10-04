// Razorpay, for taking payment and giving it back (docs/decisions/0045-self-serve-booking.md), and what its
// webhook carries. Orders, refunds and payment links are made here; what happened to a payment arrives by the signed
// webhook (docs/decisions/0044-payments-mirror.md), and the cron reads an order's payments or a link from here only
// when the webhook may have missed one (src/domain/razorpay-catch-up.ts). Amounts are in paise. Only
// src/providers/payments.ts chooses this client.
//
//   POST https://api.razorpay.com/v1/orders                   { id }
//   GET  https://api.razorpay.com/v1/orders/{id}/payments     { items: [payment] }
//   POST https://api.razorpay.com/v1/payments/{id}/refund     { id }; a receipt used before on the payment is
//        refused as "Duplicate receipt found for this refund request.", Razorpay's idempotency for refunds
//        (https://razorpay.com/docs/api/refunds/create-normal/)
//   POST https://api.razorpay.com/v1/payment_links            { id, short_url }
//   GET  https://api.razorpay.com/v1/payment_links?reference_id=  { payment_links: [{ id, short_url }] }
//   POST https://api.razorpay.com/v1/payment_links/{id}/notify_by/sms   { success: true }
//   GET  https://api.razorpay.com/v1/payment_links/{id}       { id, status, reference_id, order_id }
//   POST https://api.razorpay.com/v1/payment_links/{id}/cancel     { id, status: "cancelled" }
//
// A payment link is texted to the client by Razorpay itself, so it needs no template of ours and no secret beyond the
// keys (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).

import { z } from "zod";
import type { RazorpaySettings } from "../config/settings.ts";
import { saltedHash, secretsMatch } from "../lib/hash.ts";
import type { Logger } from "../log.ts";
import { PaymentUnanswered, type PaymentsProvider } from "./payments.ts";
import { ProviderError } from "./provider-error.ts";
import { parseAnswer, vendorAnswerOf } from "./vendor-answer.ts";
import { vendorFetch, VendorUnreachable } from "./vendor-fetch.ts";

/** Whether a webhook body is Razorpay's: X-Razorpay-Signature is the HMAC-SHA256 of the raw body under the secret. */
export async function signedByRazorpay(secret: string, body: string, signature: string): Promise<boolean> {
  return secretsMatch(signature, await saltedHash(secret, body));
}

/** The fields of Razorpay's payment entity, as its webhook and an order's payments carry it, that the mirror reads. */
export const RazorpayPaymentSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  /** Whether the money was ever taken: a refunded payment's status no longer says. */
  captured: z.boolean().nullish(),
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

/** The fields of Razorpay's payment link entity, as its webhook and a read of the link carry it, that the mirror reads. */
export const RazorpayPaymentLinkSchema = z.object({
  id: z.string(),
  status: z.string(),
  /**
   * Ours: the reference the link's payment takes, or the visit's ID on a link ops made by hand in Razorpay's dashboard.
   * A link made before links had a reference carries the visit's or the hold's ID.
   */
  reference_id: z.string().nullish(),
  /** The order Razorpay made for the link, which its payment names too. */
  order_id: z.string().nullish(),
});

export type RazorpayPaymentLink = z.infer<typeof RazorpayPaymentLinkSchema>;

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
const TIMEOUT_MS = 10_000;
/** Razorpay's refusal of a refund under a receipt a refund of the payment already carries. */
const DUPLICATE_RECEIPT = "Duplicate receipt found for this refund request.";
const Created = z.object({ id: z.string() });
const OrderPayments = z.object({ items: z.array(RazorpayPaymentSchema) });
const LinkMade = z.object({ id: z.string(), short_url: z.string() });
const LinksFound = z.object({ payment_links: z.array(LinkMade) });
const Notified = z.object({ success: z.literal(true) });

/**
 * How a link's page reads: in our name rather than the account's, and our reference labelled as one rather than as a
 * receipt. Razorpay never fills in the client's number on a link's page, whatever it is sent.
 */
const LINK_PAGE = {
  checkout: { name: "Mane Man" },
  hosted_page: { label: { receipt: "REFERENCE" } },
};

/** Razorpay's reason for a refusal, as much of it as it gave. */
const Refused = z.object({
  error: z.object({
    code: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
  }),
});

/** Razorpay's own code in a refusal, for the log. */
const refusalCodeOf = (body: unknown): string | null => Refused.safeParse(body).data?.error.code ?? null;

/** Razorpay's refusal, or its failure, read as any vendor's is (src/providers/provider-error.ts). */
export class RazorpayError extends ProviderError {
  readonly description: string;

  constructor(status: number, code: string, description: string) {
    super(status, code, `Razorpay ${String(status)} ${code}: ${description}`);
    this.name = "RazorpayError";
    this.description = description;
  }
}

export function createRazorpay(
  settings: RazorpaySettings,
  deps: { fetch: typeof fetch; log: Logger },
): PaymentsProvider {
  const authorization = `Basic ${btoa(`${settings.keyId}:${settings.keySecret}`)}`;

  /** One call: a POST with its body, or a GET with none. */
  async function call<Answer>(
    step: string,
    path: string,
    body: object | null,
    shape: z.ZodType<Answer>,
  ): Promise<Answer> {
    const response = await vendorFetch(
      deps,
      { vendor: "razorpay", step, timeoutMs: TIMEOUT_MS, codeOf: refusalCodeOf },
      `${API}${path}`,
      {
        method: body === null ? "GET" : "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (response instanceof VendorUnreachable) throw response;
    if (!response.ok) {
      const error = Refused.safeParse(await response.json().catch(() => null)).data?.error;
      throw new RazorpayError(response.status, error?.code ?? "UNKNOWN", error?.description ?? "no description");
    }
    return parseAnswer(shape, await vendorAnswerOf("Razorpay", step, response));
  }

  return {
    createOrder: (order) => call("create_order", "/orders", { ...order, currency: "INR" }, Created),
    orderPayments: async (orderId) => {
      const path = `/orders/${encodeURIComponent(orderId)}/payments`;
      return (await call("order_payments", path, null, OrderPayments)).items;
    },
    // Only a refusal Razorpay gave in words is one; a timeout, a failure of its own or an answer we cannot read
    // leaves the refund made or not.
    refund: async (paymentId, refund) => {
      try {
        const path = `/payments/${encodeURIComponent(paymentId)}/refund`;
        return await call("refund", path, { ...refund, speed: "normal" }, Created);
      } catch (error) {
        if (!(error instanceof RazorpayError) || error.status >= 500) throw new PaymentUnanswered("refund", error);
        if (error.description === DUPLICATE_RECEIPT) return { id: null };
        throw error;
      }
    },
    createPaymentLink: async (link) => {
      const made = await call(
        "create_payment_link",
        "/payment_links",
        {
          amount: link.amount,
          currency: "INR",
          accept_partial: false,
          reference_id: link.reference,
          description: link.description,
          customer: link.customer,
          notify: { sms: link.notify, email: false },
          reminder_enable: link.notify,
          notes: link.notes,
          expire_by: Math.floor(link.closesAt.getTime() / 1000),
          options: LINK_PAGE,
        },
        LinkMade,
      );
      return { id: made.id, shortUrl: made.short_url };
    },
    findPaymentLink: async (reference) => {
      const path = `/payment_links?reference_id=${encodeURIComponent(reference)}`;
      const [found] = (await call("find_payment_link", path, null, LinksFound)).payment_links;
      return found === undefined ? null : { id: found.id, shortUrl: found.short_url };
    },
    resendPaymentLink: async (linkId) => {
      const path = `/payment_links/${encodeURIComponent(linkId)}/notify_by/sms`;
      await call("resend_payment_link", path, {}, Notified);
    },
    paymentLink: (linkId) =>
      call("payment_link", `/payment_links/${encodeURIComponent(linkId)}`, null, RazorpayPaymentLinkSchema),
    cancelPaymentLink: async (linkId) => {
      await call("cancel_payment_link", `/payment_links/${encodeURIComponent(linkId)}/cancel`, {}, Created);
    },
  };
}
