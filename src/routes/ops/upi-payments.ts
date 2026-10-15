// A visit paid by UPI at the visit, while online payment is off: ops record the payment once it reaches the account
// (docs/decisions/0208-paid-at-the-visit-by-upi.md), which sends the client their receipt.

import { z } from "@hono/zod-openapi";
import { recordUpiPayment } from "../../domain/money/upi-payments.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { withinRouteReach } from "../../http/staff-access.ts";

/** A UPI transaction's reference, the UTR the bank or the client's UPI app shows: letters and digits. */
const Utr = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{6,35}$/)
  .openapi({
    description: "The UPI transaction's reference (UTR), as the bank's statement or the client's app shows it.",
  });

const upiPaymentRoute = opsRoute({
  method: "post",
  path: "/api/visits/{id}/upi-payment",
  summary: "Record the client's UPI payment for a visit paid at the visit, which sends them their receipt",
  request: {
    params: z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) }),
    body: { required: true, ...json(z.object({ utr: Utr }).strict().openapi("UpiPayment")) },
  },
  responses: {
    200: { description: "Recorded", ...json(z.object({ payment_id: z.string() }).strict().openapi("UpiRecorded")) },
    400: errorResponse("invalid_request: fields names utr"),
    404: errorResponse("not_found: no such visit in the caller's cities"),
    409: errorResponse(
      "not_due: the visit is not one paid at the visit; already_paid: its payment is recorded; reference_used: that " +
        "UTR is recorded against another payment",
    ),
  },
});

export function registerOpsUpiPayments(app: App): void {
  app.openapi(upiPaymentRoute, async (c) => {
    const visitId = c.req.valid("param").id;
    if (!(await withinRouteReach(c, "visit", visitId))) return refuse(c, "not_found");
    const recorded = await recordUpiPayment(
      c.env.DB,
      { visitId, utr: c.req.valid("json").utr.toUpperCase() },
      { actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() },
    );
    if (recorded.kind !== "recorded") return refuse(c, recorded.kind);
    c.var.log.info("upi_payment_recorded", { appointment_id: visitId, payment_id: recorded.paymentId });
    return c.json({ payment_id: recorded.paymentId }, 200);
  });
}
