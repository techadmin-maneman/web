// Where maneman.in/pay/<token>, the button on a payment link's WhatsApp message, sends the client: Razorpay's link while
// it is open (docs/decisions/0300-payment-links-on-whatsapp.md). mm-site's Worker asks, and redirects, or says the link
// has closed. An open token is always answered, so clients behind one carrier's address are never kept from theirs; a
// token closed or never made counts against the address it comes from, which is refused once it has missed too often.
// A link paid, or cancelled at Razorpay, is answered while it is open: Razorpay's own page says so.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { visitorOf } from "../../http/visitor.ts";
import { openPayLink } from "../../domain/money/pay-links.ts";
import { isSpent, takeOne } from "../../domain/sign-in/rate-limit.ts";

const OpenPayLinkSchema = z
  .object({ url: z.url().openapi({ description: "Razorpay's address for the link." }) })
  .strict()
  .openapi("OpenPayLink");

const payLinkRoute = createRoute({
  method: "get",
  path: "/api/pay/{token}",
  summary: "Razorpay's address for a payment link sent on WhatsApp, while it is open.",
  request: { params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }) },
  responses: {
    200: { description: "Open", content: { "application/json": { schema: OpenPayLinkSchema } } },
    400: errorResponse("invalid_request: not a token we make"),
    404: errorResponse("not_found: closed or never made"),
    429: errorResponse("rate_limited: closed or never made, and this address has asked for too many such this hour"),
  },
});

export function registerPayLinks(app: App): void {
  app.openapi(payLinkRoute, async (c) => {
    const { token } = c.req.valid("param");
    const at = { now: c.var.deps.now(), settings: c.var.config.settings };
    const { ipHash } = await visitorOf(c);
    const url = await openPayLink(c.env.DB, token, at.now);
    if (url !== null) return c.json({ url }, 200, { "Cache-Control": "no-store" });
    if (await isSpent(c.env.DB, "pay_link_miss:ip", ipHash, at)) return refuse(c, "rate_limited");
    await takeOne(c.env.DB, "pay_link_miss:ip", ipHash, at);
    return refuse(c, "not_found");
  });
}
