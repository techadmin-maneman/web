// A payment refunded by ops, with why (src/domain/money/payment-refunds.ts), behind Access:
//   POST /api/payments/{id}/refund   what is left of a captured payment, asked of Razorpay once
//
// Finance's to MANAGE. The refund shows on the client's Payments tab once Razorpay's webhook records it.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { MAX_NOTE } from "../../config/consumables.ts";
import { capturedPayment, refundPayment } from "../../domain/money/payment-refunds.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";

const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^\p{Cc}]+$/u);

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const refundRoute = createRoute({
  method: "post",
  path: "/api/payments/{id}/refund",
  summary: "What is left of a captured payment refunded, with why: one the client made twice",
  request: {
    params: z.object({ id: z.uuid() }),
    body: { required: true, ...json(z.object({ reason: Note }).strict().openapi("PaymentRefund")) },
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
    400: errorResponse("invalid_request: no reason given"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no captured payment, or the client is outside the caller's cities"),
    409: errorResponse("refund_not_due: the payment is refunded already, or its refund is on its way"),
    503: errorResponse("unavailable: Razorpay did not make the refund; ops are told to make it by hand"),
  },
});

export function registerOpsPaymentRefunds(app: App): void {
  app.openapi(refundRoute, async (c) => {
    const { id } = c.req.valid("param");
    const paid = await capturedPayment(c.env.DB, id);
    if (paid === null || (await clientInReach(c, paid.person_id)) === null) return refuse(c, "not_found");
    const refunded = await refundPayment(
      c.env.DB,
      c.var.deps,
      { paymentId: id, reason: c.req.valid("json").reason },
      written(c),
    );
    if (refunded.kind === "missing") return refuse(c, "not_found");
    if (refunded.kind === "nothing_left") return refuse(c, "refund_not_due");
    if (refunded.kind === "left_to_ops") return refuse(c, "unavailable");
    return c.json({ amount: refunded.amount }, 200);
  });
}
