// Razorpay's webhook (docs/decisions/0044-payments-mirror.md). Each event is signed: X-Razorpay-Signature is the
// HMAC-SHA256 of the raw body under the webhook secret. Razorpay delivers at least once and not in order, and expects
// an answer within five seconds; X-Razorpay-Event-Id says which deliveries are the same event. So the webhook only
// checks the signature, claims the event by its ID, and queues it: the queue's consumer applies it
// (src/queues/razorpay.ts), and a delivery of an event already claimed is answered at once.
//
// Subscribed events (provisioning, step 11c): order.paid, payment.authorized, payment.captured, payment.failed,
// refund.created, refund.processed, refund.failed, refund.speed_changed, and payment_link.paid. Any other is
// acknowledged and applied as nothing.

import { createRoute } from "@hono/zod-openapi";
import { RazorpayEventMessageSchema, type RazorpayEventMessage } from "../../config/pipeline.ts";
import { claimEvent, RazorpayEventSchema, releaseEvent } from "../../domain/money/razorpay-events.ts";
import { enqueue } from "../../domain/platform/enqueue.ts";
import type { App } from "../../http/context.ts";
import { cappedBody } from "../../http/capped-body.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { sha256Hex } from "../../lib/hash.ts";
import { signedByRazorpay } from "../../providers/payments/razorpay.ts";

const razorpayHookRoute = createRoute({
  method: "post",
  path: "/api/hooks/razorpay",
  summary: "Razorpay's webhook: payments and refunds",
  responses: {
    200: { description: "Taken, or ignored. Either way Razorpay need not send it again" },
    401: errorResponse("unauthorized: the signature does not match"),
    404: errorResponse("not_found: the webhook is not switched on (no RAZORPAY_WEBHOOK_SECRET)"),
    503: errorResponse("unavailable: the event could not be queued; Razorpay sends it again"),
  },
});

/** The longest event body read. */
const MAX_EVENT_BYTES = 1024 * 1024;

export function registerRazorpayHook(app: App): void {
  app.openapi(razorpayHookRoute, async (c) => {
    const { requestId, log, config, deps } = c.var;
    const secret = config.settings.razorpay?.webhookSecret ?? null;
    if (secret === null) return refuse(c, "not_found");

    // Razorpay's events are a few KB: a body past the cap is none of theirs, refused as unsigned without reading on.
    const bytes = await cappedBody(c.req.raw, MAX_EVENT_BYTES);
    const body = bytes === null ? null : new TextDecoder().decode(bytes);
    const signature = c.req.header("X-Razorpay-Signature") ?? "";
    if (body === null || !(await signedByRazorpay(secret, body, signature))) {
      log.warn("razorpay_hook_unauthorized");
      return refuse(c, "unauthorized");
    }

    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      // A signed body that is not JSON: nothing to do, and nothing Razorpay can do about it.
    }
    const parsed = RazorpayEventSchema.safeParse(json);
    if (!parsed.success) {
      log.warn("razorpay_hook_unreadable");
      return c.body(null, 200);
    }
    const { event } = parsed.data;
    const eventId = c.req.header("X-Razorpay-Event-Id") ?? `body:${await sha256Hex(body)}`;
    const db = c.env.DB;

    if (!(await claimEvent(db, { id: eventId, name: event, at: deps.now() }))) {
      log.info("razorpay_hook_repeat", { event });
      return c.body(null, 200);
    }
    const message = RazorpayEventMessageSchema.parse({
      event_id: eventId,
      request_id: requestId,
      body,
    } satisfies RazorpayEventMessage);
    if (!(await enqueue(c.env.RAZORPAY_QUEUE, message, { log, ifLost: "sender" }))) {
      // Let go, so Razorpay's next delivery is claimed and queued.
      await releaseEvent(db, eventId);
      return refuse(c, "unavailable");
    }
    log.info("razorpay_hook_queued", { event });
    return c.body(null, 200);
  });
}
