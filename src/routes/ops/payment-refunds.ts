// A payment refunded by ops, with why (src/domain/money/payment-refunds.ts), behind Access.
//
// Finance's to MANAGE. The refund shows on the client's Payments tab once Razorpay's webhook records it.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { MAX_NOTE } from "../../config/consumables.ts";
import { capturedPayment, refundPayment } from "../../domain/money/payment-refunds.ts";
import { written } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";

const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^\p{Cc}]+$/u);

const refundRoute = opsRoute({
  method: "post",
  path: "/api/payments/{id}/refund",
  summary: "What is left of a captured payment, or part of it, refunded with why: one the client made twice",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            reason: Note,
            amount: z.number().int().positive().optional().openapi({
              description: "In paise: part of what is left, given back. Left out, all that is left goes back.",
            }),
            key: z
              .uuid()
              .optional()
              .openapi({
                description:
                  "With an amount: the key the console's drawer made once, when it opened. A part refund pressed " +
                  "again from the same drawer shares it, so Razorpay makes it once.",
              }),
          })
          .strict()
          .refine((body) => body.amount === undefined || body.key !== undefined, {
            message: "a part refund names the key of the drawer it was asked from",
            path: ["key"],
          })
          .openapi("PaymentRefund"),
      ),
    },
  },
  responses: {
    200: {
      description: "Asked of Razorpay; it shows on the Payments tab once processed",
      ...json(
        z
          .object({ amount: z.number().int().openapi({ description: "In paise: what was asked back." }) })
          .strict()
          .openapi("PaymentRefunded"),
      ),
    },
    400: errorResponse(
      "invalid_request: no reason given, an amount of nothing or above what is left, or a part with no key (fields)",
    ),
    404: errorResponse("not_found: no captured payment, or the client is outside the caller's cities"),
    409: errorResponse(
      "refund_not_due: the payment is refunded already, or its refund is on its way; paid_by_upi: it was paid by " +
        "UPI to the bank, which is how ops refund it",
    ),
    503: errorResponse("unavailable: Razorpay did not make the refund; ops are told to make it by hand"),
  },
});

export function registerOpsPaymentRefunds(app: App): void {
  app.openapi(refundRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { reason, amount, key } = c.req.valid("json");
    const paid = await capturedPayment(c.env.DB, id);
    if (paid === null || (await clientInReach(c, paid.person_id)) === null) return refuse(c, "not_found");
    const part = amount === undefined || key === undefined ? {} : { part: { amount, key } };
    const refunded = await refundPayment(c.env.DB, c.var.deps, { paymentId: id, reason, ...part }, written(c));
    if (refunded.kind === "missing") return refuse(c, "not_found");
    if (refunded.kind === "nothing_left") return refuse(c, "refund_not_due");
    if (refunded.kind === "more_than_left") return refuse(c, "invalid_request", ["amount"]);
    if (refunded.kind === "left_to_ops") return refuse(c, "unavailable");
    if (refunded.kind === "by_upi") return refuse(c, "paid_by_upi");
    return c.json({ amount: refunded.amount }, 200);
  });
}
