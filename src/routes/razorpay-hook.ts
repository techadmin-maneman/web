// POST /api/hooks/razorpay: Razorpay's webhook (docs/decisions/0044-payments-mirror.md).
// Each event is signed: X-Razorpay-Signature is the HMAC-SHA256 of the raw
// body under the webhook secret. Razorpay delivers at least once and not in
// order, and expects an answer within five seconds; X-Razorpay-Event-Id says
// which deliveries are the same event.
//
// Subscribed events (runbook, step 11c): order.paid, payment.authorized,
// payment.captured, payment.failed, refund.created, refund.processed,
// refund.failed, refund.speed_changed, and payment_link.paid, which names the
// payment link a one visit's client paid by and so the visit it is for
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md), or the link a
// client paid for a visit ops booked, and so the hold it waits on
// (src/domain/visit-booking.ts). Any other is acknowledged and ignored.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { paymentStatusOf, recordPayment, recordRefund } from "../domain/payments.ts";
import { bookHold } from "../http/book-hold.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { sha256Hex } from "../lib/hash.ts";
import { markLinkPaid, visitOfLink } from "../domain/payment-links.ts";
import { holdOfLink, recordHoldLinkPaid, type LinkHold } from "../domain/visit-booking.ts";
import {
  RazorpayPaymentLinkSchema,
  RazorpayPaymentSchema,
  RazorpayRefundSchema,
  signedByRazorpay,
  type RazorpayPayment,
  type RazorpayPaymentLink,
} from "../providers/razorpay.ts";

const EventSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
      refund: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
      payment_link: z.object({ entity: z.looseObject({ id: z.string() }) }).optional(),
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

/**
 * A one visit's payment link paid: the payment recorded as the visit's, by the link it paid, whatever notes it
 * carries, and the link marked paid where the close made one; a link ops made by hand has no row of ours. False for
 * a link that names no visit of ours.
 */
async function linkPaid(
  db: D1Database,
  paid: { readonly link: RazorpayPaymentLink; readonly payment: RazorpayPayment },
  hashSalt: string,
  now: Date,
): Promise<boolean> {
  const ours = await visitOfLink(db, { razorpayLinkId: paid.link.id, reference: paid.link.reference_id ?? null });
  if (ours === null) return false;
  const notes =
    ours.personId === null
      ? { appointment_id: ours.appointmentId }
      : { appointment_id: ours.appointmentId, person_id: ours.personId };
  await recordPayment(db, { ...paid.payment, notes }, "captured", hashSalt, now);
  if (ours.linkId === null) return true;
  const paidAt = new Date(paid.payment.created_at * 1000).toISOString();
  await markLinkPaid(db, ours.linkId, { razorpayPaymentId: paid.payment.id, paidAt }, now);
  return true;
}

/**
 * The link a client paid for a visit ops booked: the payment is recorded on the hold the link was for, which confirms
 * it, and the hold goes to be booked, as a payment at Checkout does. A payment Razorpay names no order for is recorded
 * as the client's, and ops are told once to book or refund it.
 */
async function holdLinkPaid(
  c: Context<AppEnv>,
  paid: { readonly hold: LinkHold; readonly link: RazorpayPaymentLink; readonly payment: RazorpayPayment },
): Promise<void> {
  const { hold, link, payment } = paid;
  const { deps, config, log } = c.var;
  const db = c.env.DB;
  const now = deps.now();
  const orderId = payment.order_id ?? link.order_id ?? null;
  if (orderId === null) {
    const notes = { hold_id: hold.id, person_id: hold.personId };
    await recordPayment(db, { ...payment, notes }, "captured", config.settings.ipHashSalt, now);
    log.warn("razorpay_hook_hold_link_without_order", { hold_id: hold.id });
    await deps.alertOnce({
      key: `hold_link_without_order:${hold.id}`,
      message:
        `The client paid the payment link for booking ${hold.id} (payment ${payment.id}), but Razorpay named no ` +
        "order for it, so the visit was not booked. Book it for them, or refund the payment in Razorpay's dashboard.",
      link: `/clients/${hold.personId}`,
    });
    return;
  }
  await recordHoldLinkPaid(db, { hold, payment, orderId }, config.settings.ipHashSalt, now);
  await bookHold(c, hold.id);
  log.info("razorpay_hook_hold_link_paid", { hold_id: hold.id });
}

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
    if (event === "payment_link.paid" && payload?.payment_link !== undefined && payload.payment !== undefined) {
      const link = RazorpayPaymentLinkSchema.parse(payload.payment_link.entity);
      const payment = RazorpayPaymentSchema.parse(payload.payment.entity);
      const hold = await holdOfLink(db, { razorpayLinkId: link.id, reference: link.reference_id ?? null });
      if (hold === null) {
        const paid = await linkPaid(db, { link, payment }, config.settings.ipHashSalt, now);
        log.info("razorpay_hook_link_paid", { ours: paid });
      } else {
        await holdLinkPaid(c, { hold, link, payment });
      }
    } else if (payload?.payment !== undefined && !event.startsWith("refund.")) {
      const payment = RazorpayPaymentSchema.parse(payload.payment.entity);
      const status = paymentStatusOf(event, payment);
      if (status !== null) await recordPayment(db, payment, status, config.settings.ipHashSalt, now);
      // Paid for a hold in the app: the booking is written now, or from FSM's queue (src/http/book-hold.ts).
      // Only the capture books it: order.paid says the same of the same payment, and the cron books a paid
      // hold that is still waiting (docs/decisions/0068-a-paid-hold-is-kept.md).
      const holdId = holdOfNotes(payment.notes);
      if (event === "payment.captured" && holdId !== null) await bookHold(c, holdId);
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
