// POST /api/hooks/razorpay: Razorpay's webhook (docs/decisions/0044-payments-mirror.md).
// Each event is signed: X-Razorpay-Signature is the HMAC-SHA256 of the raw
// body under the webhook secret. Razorpay delivers at least once and not in
// order, and expects an answer within five seconds; X-Razorpay-Event-Id says
// which deliveries are the same event.
//
// Subscribed events (runbook, step 11c): order.paid, payment.authorized,
// payment.captured, payment.failed, refund.created, refund.processed,
// refund.failed, refund.speed_changed. Any other is acknowledged and ignored.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { paymentStatusOf, recordPayment, recordRefund } from "../domain/payments.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { sha256Hex } from "../lib/hash.ts";
import {
  RazorpayPaymentSchema,
  RazorpayRefundSchema,
  signedByRazorpay,
  type RazorpayPayment,
} from "../providers/razorpay.ts";

const EventSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
      refund: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
    })
    .optional(),
});

export const razorpayHookRoute = createRoute({
  method: "post",
  path: "/api/hooks/razorpay",
  summary: "Razorpay's webhook: payments and refunds",
  responses: {
    200: { description: "Taken, or ignored. Either way Razorpay need not send it again" },
    401: errorResponse("unauthorized: the signature does not match"),
    404: errorResponse("not_found: the webhook is not switched on (no RAZORPAY_WEBHOOK_SECRET)"),
    409: errorResponse("not_ready: a refund for a payment not yet recorded; Razorpay retries it"),
  },
});

/** The hold a payment was for, from the notes our order gave it. */
function holdOfNotes(notes: RazorpayPayment["notes"]): string | null {
  if (notes === null || notes === undefined || Array.isArray(notes)) return null;
  const holdId = notes.hold_id;
  return typeof holdId === "string" && /^[0-9a-f-]{36}$/.test(holdId) ? holdId : null;
}

export function registerRazorpayHook(app: App): void {
  app.openapi(razorpayHookRoute, async (c) => {
    const { requestId, log, config, deps } = c.var;
    const secret = config.settings.razorpay?.webhookSecret ?? null;
    if (secret === null) return c.json(errorBody("not_found", requestId), 404);

    const body = await c.req.text();
    const signature = c.req.header("X-Razorpay-Signature") ?? "";
    if (!(await signedByRazorpay(secret, body, signature))) {
      log.warn("razorpay_hook_unauthorized");
      return c.json(errorBody("unauthorized", requestId), 401);
    }

    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      // A signed body that is not JSON: nothing to do, and nothing Razorpay can do about it.
    }
    const parsed = EventSchema.safeParse(json);
    if (!parsed.success) {
      log.warn("razorpay_hook_unreadable");
      return c.body(null, 200);
    }
    const { event, payload } = parsed.data;
    const now = deps.now();
    const eventId = c.req.header("X-Razorpay-Event-Id") ?? `body:${await sha256Hex(body)}`;
    const db = c.env.DB;

    const seen = await db.prepare("SELECT 1 FROM razorpay_events WHERE event_id = ?1").bind(eventId).first();
    if (seen !== null) {
      log.info("razorpay_hook_repeat", { event });
      return c.body(null, 200);
    }

    // An entity not of Razorpay's shape throws, so the event is answered 500 and Razorpay sends it again.
    if (payload?.payment !== undefined && !event.startsWith("refund.")) {
      const payment = RazorpayPaymentSchema.parse(payload.payment.entity);
      const status = paymentStatusOf(event, payment);
      if (status !== null) await recordPayment(db, payment, status, config.settings.ipHashSalt, now);
      // Paid for a hold in the app: the booking is written to FSM from the queue (src/domain/bookings.ts).
      // Only the capture queues it: order.paid says the same of the same payment, and the cron puts back a
      // paid hold whose message never came (docs/decisions/0068-a-paid-hold-is-kept.md).
      const holdId = holdOfNotes(payment.notes);
      if (event === "payment.captured" && holdId !== null) {
        await c.env.FSM_QUEUE.send({ hold_id: holdId, request_id: requestId } satisfies FsmSyncMessage);
      }
    } else if (payload?.refund !== undefined) {
      const recorded = await recordRefund(db, RazorpayRefundSchema.parse(payload.refund.entity), now);
      // Its payment's event has not arrived yet. Not kept as seen, so Razorpay's retry is applied.
      if (!recorded) {
        log.info("razorpay_hook_refund_early", { event });
        return c.json(errorBody("not_ready", requestId), 409);
      }
    } else {
      log.info("razorpay_hook_ignored", { event: event.slice(0, 40) });
    }

    await db
      .prepare("INSERT INTO razorpay_events (event_id, event, received_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING")
      .bind(eventId, event.slice(0, 60), now.toISOString())
      .run();
    log.info("razorpay_hook_taken", { event });
    return c.body(null, 200);
  });
}
