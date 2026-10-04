// A client moving or cancelling one of their visits (boards C7 and C8;
// docs/decisions/0046-moving-and-cancelling.md). Each route answers with the
// consequence before the client confirms, from src/policy/moving-a-visit.ts.
// Behind SELF_SERVE_BOOKING, as booking is.
//
//   GET  /api/appointments/:id/reschedule   what moving costs now
//   POST /api/appointments/:id/reschedule   { hold_id }: start the move a hold makes
//   POST /api/appointments/:id/cancel       { confirm: false }: what cancelling gives back; { confirm: true, notice }: cancel
//
// A move picks its new time as a booking does, through GET /api/availability
// and POST /api/holds with `moving`.

import { selfServeRoute } from "../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { cancelVisit, changeableVisit, changeTerms, termsInForce, type ChangeTerms } from "../domain/visit-changes.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { clientOf } from "../http/client-session.ts";
import { errorResponse, refuse } from "../http/errors.ts";
import { queueMessage } from "../http/queue-message.ts";
import { BookingSchema, moveTermsFor, PriceSchema, startCheckout } from "./client-booking.ts";

const NoticeSchema = z.enum(["free", "late"]).openapi({
  description:
    "free: before the notice the visit was booked under starts, counted back from its window; late: inside it.",
});

const termsOf = (terms: ChangeTerms) => ({
  visit_id: terms.visit.id,
  type: terms.visit.type,
  notice: terms.notice,
  notice_hours: terms.noticeHours,
  free_until: terms.freeUntil.toISOString(),
  paid: terms.payment?.paid ?? 0,
  credit: terms.credit?.outcome ?? null,
});

const common = {
  visit_id: z.uuid(),
  type: z.enum(VISIT_TYPES),
  notice: NoticeSchema,
  notice_hours: z.number().int().openapi({
    description: "The notice the visit was booked under, in hours: 24 unless ops had set another when it was booked.",
  }),
  free_until: z.iso.datetime(),
  paid: z.number().int().openapi({ description: "In paise: what the visit's payment holds, carried over or kept." }),
  credit: z.union([z.enum(["restored", "lost"]), z.null()]).openapi({
    description:
      "For a visit paid with a credit: whether cancelling gives it back (free) or loses it (late, or its grant " +
      "has been taken back or has expired).",
  }),
};

const MoveTermsSchema = z
  .object({
    ...common,
    cost: z.enum(["free", "late_fee", "charged"]).openapi({
      description:
        "free: the payment carries over; late_fee: the late fee is paid, then the payment carries over; " +
        "charged: the payment is kept, and the new visit is paid separately.",
    }),
    price: PriceSchema.openapi({ description: "What is paid now to move: nothing, the late fee, or the new visit." }),
  })
  .strict()
  .openapi("MoveTerms");

const CancelTermsSchema = z
  .object({
    ...common,
    refund: z.number().int().openapi({ description: "In paise: what goes back to the payment's source." }),
    kept: z.number().int().openapi({ description: "In paise: what is kept as a charge." }),
    destination: z.union([z.string(), z.null()]).openapi({ description: "The payment's method: upi, card and so on." }),
    cancelled: z.boolean().openapi({ description: "false: the terms only; true: the visit is cancelled." }),
    refund_pending: z.boolean().openapi({
      description:
        "true: the visit is cancelled, and its refund is still to be asked of Razorpay, which happens within minutes.",
    }),
  })
  .strict()
  .openapi("CancelTerms");

const params = z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) });

const moveTermsRoute = selfServeRoute({
  method: "get",
  path: "/api/appointments/{id}/reschedule",
  summary: "What moving a visit costs now",
  request: { params },
  responses: {
    200: { description: "The terms", content: { "application/json": { schema: MoveTermsSchema } } },
    401: errorResponse("session_required"),
    409: errorResponse("not_changeable"),
  },
});

const rescheduleRoute = selfServeRoute({
  method: "post",
  path: "/api/appointments/{id}/reschedule",
  summary: "Start the move a hold makes",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              hold_id: z.uuid().openapi({ description: "A hold made with `moving` for this visit." }),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: { description: "The move is started", content: { "application/json": { schema: BookingSchema } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such hold for moving this visit"),
    409: errorResponse("not_changeable; hold_expired; or ops_assisted"),
  },
});

const cancelRoute = selfServeRoute({
  method: "post",
  path: "/api/appointments/{id}/cancel",
  summary: "What cancelling a visit gives back, or cancel it on those terms",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              confirm: z.boolean(),
              notice: NoticeSchema.optional().openapi({
                description: "With confirm: the notice the client was shown.",
              }),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The terms, or the cancelled visit",
      content: { "application/json": { schema: CancelTermsSchema } },
    },
    202: {
      description: "The visit is cancelled, and its refund is on its way",
      content: { "application/json": { schema: CancelTermsSchema } },
    },
    401: errorResponse("session_required"),
    409: errorResponse(
      "not_changeable; terms_changed: the notice is not the one shown, so show the terms again; or ops_assisted",
    ),
    503: errorResponse("unavailable: the visit could not be cancelled just now; nothing changed"),
  },
});

export function registerClientChanges(app: App): void {
  app.openapi(moveTermsRoute, async (c) => {
    const move = await moveTermsFor(c, clientOf(c).subjectId, c.req.valid("param").id, null);
    if (move === null) return refuse(c, "not_changeable");
    return c.json({ ...termsOf(move.terms), cost: move.terms.move.cost, price: move.terms.move.price }, 200);
  });

  app.openapi(rescheduleRoute, async (c) => {
    const session = clientOf(c);
    const visitId = c.req.valid("param").id;
    const holdId = c.req.valid("json").hold_id;
    const hold = await c.env.DB.prepare(
      "SELECT 1 FROM slot_holds WHERE id = ?1 AND person_id = ?2 AND moves_appointment_id = ?3",
    )
      .bind(holdId, session.subjectId, visitId)
      .first();
    if (hold === null) return refuse(c, "not_found");
    const booking = await startCheckout(c, holdId, session.subjectId);
    if (booking === null) return refuse(c, "hold_expired");
    return c.json(booking, 201);
  });

  app.openapi(cancelRoute, async (c) => {
    const session = clientOf(c);
    const { deps, log } = c.var;
    const now = deps.now();
    const visit = await changeableVisit(c.env.DB, session.subjectId, c.req.valid("param").id, now);
    if (visit === null) return refuse(c, "not_changeable");
    const terms = await changeTerms(c.env.DB, visit, now, termsInForce(await opsInputs(c), visit.type));
    const body = c.req.valid("json");
    const shown = {
      ...termsOf(terms),
      refund: terms.cancel.refund,
      kept: terms.cancel.kept,
      destination: terms.payment?.method ?? null,
    };
    if (!body.confirm) return c.json({ ...shown, cancelled: false, refund_pending: false }, 200);
    if (body.notice !== terms.notice) return refuse(c, "terms_changed");

    let outcome;
    try {
      const notify = (messageId: string) => queueMessage(c, messageId);
      outcome = await cancelVisit(c.env.DB, { ...deps, notify }, terms, now, { log });
    } catch (error) {
      log.error("cancel_failed", { appointment_id: visit.id, error });
      return refuse(c, "unavailable");
    }
    if (outcome.kind === "not_changeable") return refuse(c, "not_changeable");
    log.info("visit_cancelled", { appointment_id: visit.id, notice: terms.notice, refund: outcome.refund });
    if (outcome.refundPending) return c.json({ ...shown, cancelled: true, refund_pending: true }, 202);
    return c.json({ ...shown, cancelled: true, refund_pending: false }, 200);
  });
}
