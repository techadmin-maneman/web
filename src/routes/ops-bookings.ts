// A booking FSM refused five times running, held for ops rather than refunded
// (docs/decisions/0095-a-booking-fsm-refuses-is-held.md), on the ops surface behind Access:
//
//   POST /api/held-bookings/:id/retry    try FSM again now, as the hourly try would
//   POST /api/held-bookings/:id/link     { visit_id }: the visit ops booked in FSM by hand is this booking
//   POST /api/held-bookings/:id/refund   cancel what FSM holds for it, refund it, and tell the client
//
// Each acts only on a booking still waiting (src/domain/held-bookings.ts), and
// each change is audited in the batch that makes it (ADR 0031): a try FSM
// refuses, or a refund Razorpay refuses, changes nothing, and is recorded only
// as the call every ops request is. The client's page lists the bookings, with
// these three beside each (GET /api/clients/:id).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { auditStatement, type AuditAction } from "../domain/audit.ts";
import {
  bookAsVisit,
  confirmBooking,
  giveUpOnBooking,
  unbookedAlertKey,
  type Confirmed,
  type ConfirmOptions,
  type GaveUp,
  type LeftInFsm,
} from "../domain/bookings.ts";
import { heldAlertKey, heldBookingById, holdForFsm, refundedMessage } from "../domain/held-bookings.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { failureReason } from "../log.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

const heldId = z.object({ id: z.uuid().openapi({ description: "The booking's hold." }) });
const notWaiting = errorResponse("not_found: no booking held for FSM with that id; it may be booked or refunded");

const LeftInFsmSchema = z
  .object({
    kind: z.enum(["nothing", "cancelled", "not_cancelled", "unknown"]).openapi({
      description:
        "What an earlier try left in FSM: nothing; a work order now cancelled; one FSM would not cancel, to cancel " +
        'by hand; or unknown, when FSM could not be asked, so look for "(booking <id>)" among its work orders.',
    }),
    work_order_id: z.union([z.string(), z.null()]).openapi({ description: "FSM's, where there is one to name." }),
  })
  .strict()
  .openapi("LeftInFsm");

const retryRoute = createRoute({
  method: "post",
  path: "/api/held-bookings/{id}/retry",
  summary: "Try FSM again now for a booking it refused, as the hourly try would",
  request: { params: heldId },
  responses: {
    200: {
      description: "What FSM made of it",
      ...json(
        z
          .object({
            outcome: z.enum(["booked", "being_booked", "given_back", "refused"]).openapi({
              description:
                "booked: in FSM and the mirror, and the client told. being_booked: another try is writing it now. " +
                "given_back: its payment had been refunded, or its hold lapsed, so it was let go. refused: FSM " +
                "refused again, and it waits as before.",
            }),
            refusal: z
              .union([z.string(), z.null()])
              .openapi({ description: "FSM's refusal, as the log gives it, when it refused." }),
          })
          .strict()
          .openapi("HeldBookingTried"),
      ),
    },
    403: errorResponse("access_required"),
    404: notWaiting,
    409: errorResponse("not_changeable: the visit's time has passed; refund it, or link a visit booked in FSM"),
  },
});

const linkRoute = createRoute({
  method: "post",
  path: "/api/held-bookings/{id}/link",
  summary: "The visit ops booked in FSM by hand is this booking: book it as that visit, and make nothing twice",
  request: {
    params: heldId,
    body: {
      required: true,
      ...json(
        z
          .object({
            visit_id: z.uuid().openapi({
              description:
                "The visit, as the client's page lists it once FSM's webhook or the reconciliation has mirrored it: " +
                "the client's, of the booking's kind, still to happen, and no other booking's.",
            }),
          })
          .strict()
          .openapi("HeldBookingLink"),
      ),
    },
  },
  responses: {
    200: {
      description: "Booked as the visit, and the client told",
      ...json(z.object({ fsm: LeftInFsmSchema }).strict().openapi("HeldBookingLinked")),
    },
    400: errorResponse("invalid_request: not a visit this booking can be, or the booking moves a visit"),
    403: errorResponse("access_required"),
    404: notWaiting,
    409: errorResponse("superseded: a try is writing the booking to FSM at this moment; look again in a minute"),
  },
});

const MoneySchema = z
  .object({
    kind: z.enum(["refunded", "refunded_before", "nothing_paid", "booked", "refund_refused"]).openapi({
      description:
        "refunded in full now; refunded_before, by an earlier press; nothing_paid, as a free or credit booking; " +
        "booked, by a try that landed meanwhile, so nothing is refunded; refund_refused by Razorpay, so nothing has " +
        "gone back and the booking still waits.",
    }),
    payment_id: z.union([z.string(), z.null()]).openapi({ description: "Razorpay's, where there is a payment." }),
    amount: z.union([z.number().int(), z.null()]).openapi({ description: "In paise, where one was refunded." }),
  })
  .strict()
  .openapi("HeldBookingMoney");

const refundRoute = createRoute({
  method: "post",
  path: "/api/held-bookings/{id}/refund",
  summary: "Give back a booking FSM would not take: its work order cancelled, its payment refunded, the client told",
  request: { params: heldId },
  responses: {
    200: {
      description: "What happened to the money and to FSM",
      ...json(z.object({ money: MoneySchema, fsm: LeftInFsmSchema }).strict().openapi("HeldBookingRefunded")),
    },
    403: errorResponse("access_required"),
    404: notWaiting,
    409: errorResponse("superseded: a try is writing the booking to FSM at this moment; look again in a minute"),
  },
});

/** The answer's name for what an earlier try left in FSM. */
const leftOf = (left: LeftInFsm) => ({
  kind: left.kind,
  work_order_id: left.kind === "cancelled" || left.kind === "not_cancelled" ? left.workOrderId : null,
});

function moneyOf(money: GaveUp["money"]) {
  switch (money.kind) {
    case "refunded":
    case "refund_refused":
      return { kind: money.kind, payment_id: money.paymentId, amount: money.amount };
    case "refunded_before":
      return { kind: money.kind, payment_id: money.paymentId, amount: null };
    case "nothing_paid":
    case "booked":
      return { kind: money.kind, payment_id: null, amount: null };
  }
}

/** The console's name for how a try ended. */
function outcomeOf(confirmed: Confirmed): "booked" | "being_booked" | "given_back" {
  if (confirmed === "booked" || confirmed === "already_booked") return "booked";
  if (confirmed === "being_booked") return "being_booked";
  return "given_back";
}

/** The entry an action on a held booking writes with its change. */
function auditOf(c: Context<AppEnv>, action: AuditAction, holdId: string, detail?: Record<string, string>) {
  return auditStatement(
    c.env.DB,
    {
      surface: "ops",
      actor: staffOf(c),
      action,
      subject: { kind: "slot_hold", id: holdId },
      requestId: c.var.requestId,
      ...(detail === undefined ? {} : { detail }),
    },
    c.var.deps.now(),
  );
}

/** What booking it needs, as the queue's consumer books it: the client told, and ops told of FSM's leftovers. */
function bookingOptions(c: Context<AppEnv>, alongside: D1PreparedStatement): ConfirmOptions {
  const { deps, requestId, config, log } = c.var;
  return {
    labelAsTest: config.environment !== "production",
    notify: (messageId) =>
      c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage),
    alertOnce: deps.alertOnce,
    log,
    alongside: [alongside],
  };
}

/** Whatever ops were told of the booking while it waited is over. */
async function closeAlerts(c: Context<AppEnv>, holdId: string): Promise<void> {
  await c.var.deps.resolveAlert(heldAlertKey(holdId));
  await c.var.deps.resolveAlert(unbookedAlertKey(holdId));
}

export function registerOpsBookings(app: App): void {
  app.openapi(retryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { deps, requestId, log } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    const waiting = await heldBookingById(db, id);
    if (waiting === null) return c.json(errorBody("not_found", requestId), 404);
    if (waiting.startsAt <= now) return c.json(errorBody("not_changeable", requestId), 409);

    try {
      const confirmed = await confirmBooking(
        db,
        deps.fsm,
        deps.payments,
        id,
        now,
        bookingOptions(c, auditOf(c, "booking.retry", id)),
      );
      const outcome = outcomeOf(confirmed);
      if (outcome !== "being_booked") await closeAlerts(c, id);
      log.info("held_booking_tried", { hold_id: id, outcome: confirmed });
      return c.json({ outcome, refusal: null }, 200);
    } catch (error) {
      const refusal = failureReason(error);
      await holdForFsm(db, id, now, refusal);
      log.warn("held_booking_refused", { hold_id: id, reason: refusal });
      return c.json({ outcome: "refused" as const, refusal }, 200);
    }
  });

  app.openapi(linkRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { visit_id: visitId } = c.req.valid("json");
    const { deps, requestId, log } = c.var;
    const db = c.env.DB;
    if ((await heldBookingById(db, id)) === null) return c.json(errorBody("not_found", requestId), 404);

    const linked = await bookAsVisit(
      db,
      deps.fsm,
      { holdId: id, visitId },
      deps.now(),
      bookingOptions(c, auditOf(c, "booking.link", id, { visit_id: visitId })),
    );
    if (linked.kind === "not_waiting") return c.json(errorBody("not_found", requestId), 404);
    if (linked.kind === "not_the_visit") return c.json(errorBody("invalid_request", requestId, ["visit_id"]), 400);
    if (linked.kind === "being_booked") return c.json(errorBody("superseded", requestId), 409);
    await closeAlerts(c, id);
    log.info("held_booking_linked", { hold_id: id, appointment_id: visitId, fsm: linked.fsm.kind });
    return c.json({ fsm: leftOf(linked.fsm) }, 200);
  });

  app.openapi(refundRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { deps, requestId, config, log } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    const waiting = await heldBookingById(db, id);
    if (waiting === null) return c.json(errorBody("not_found", requestId), 404);

    const message = refundedMessage(db, { personId: waiting.personId, holdId: id, now });
    const gaveUp = await giveUpOnBooking(db, deps.fsm, deps.payments, id, now, {
      labelAsTest: config.environment !== "production",
      alongside: [message.statement, auditOf(c, "booking.refund", id)],
    });
    if (gaveUp === "being_booked") return c.json(errorBody("superseded", requestId), 409);
    log.info("held_booking_refunded", { hold_id: id, money: gaveUp.money.kind, fsm: gaveUp.fsm.kind });
    const givenBack = gaveUp.money.kind !== "refund_refused" && gaveUp.money.kind !== "booked";
    if (givenBack) {
      await closeAlerts(c, id);
      await c.env.MESSAGE_QUEUE.send({ message_id: message.id, request_id: requestId } satisfies MessagingMessage);
    }
    return c.json({ money: moneyOf(gaveUp.money), fsm: leftOf(gaveUp.fsm) }, 200);
  });
}
