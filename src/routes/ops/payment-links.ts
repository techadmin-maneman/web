// A one visit's payment link, behind Access:
//   POST /api/payment-links/:id/resend   Razorpay texts the client the link again, or makes it now if it never did
//
// The Tasks board's "Payment owed" row names the link by its own ID. The call is audited as every ops call is.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { resendLink } from "../../domain/money/payment-links.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";

const ResentSchema = z
  .object({
    outcome: z.enum(["resent", "sent", "not_texted", "paid", "refused"]).openapi({
      description:
        "resent: Razorpay texted the link again; sent: the link was never made, and now is and has been texted; " +
        "not_texted: messaging may not text this number (a staging test record), so nothing was sent; " +
        "paid: the client has paid, so nothing was sent; refused: Razorpay refused to make it, so ops send one from " +
        "Razorpay's dashboard.",
    }),
  })
  .strict()
  .openapi("PaymentLinkResent");

const resendRoute = createRoute({
  method: "post",
  path: "/api/payment-links/{id}/resend",
  summary: "Text the client their payment link again",
  request: { params: z.object({ id: z.uuid().openapi({ description: "The link's own ID, as the task names it." }) }) },
  responses: {
    200: { description: "What sending it again came to", ...json(ResentSchema) },
    403: errorResponse("access_required, or not_permitted"),
    404: errorResponse("not_found: no such link, or its client is erased"),
    503: errorResponse("unavailable: Razorpay did not answer; try again in a minute"),
  },
});

export function registerOpsPaymentLinks(app: App): void {
  app.openapi(resendRoute, async (c) => {
    const { deps, log } = c.var;
    const linkDeps = { ...deps, log, messagingSettings: c.var.config.settings.messaging };
    const outcome = await resendLink(c.env.DB, linkDeps, c.req.valid("param").id, deps.now());
    if (outcome === "not_found") return refuse(c, "not_found");
    if (outcome === "unavailable") return refuse(c, "unavailable");
    return c.json({ outcome }, 200);
  });
}
