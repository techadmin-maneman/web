// A client moving or cancelling one of their visits (boards C7 and C8;
// docs/decisions/0046-moving-and-cancelling.md). Each route answers with the
// consequence before the client confirms, from src/policy/moving-a-visit.ts.
// Behind SELF_SERVE_BOOKING, as booking is.
//
//   POST /api/appointments/:id/reschedule   {}: what moving costs now; { hold_id }: start the move a hold makes
//   POST /api/appointments/:id/cancel       { confirm: false }: what cancelling gives back; { confirm: true, notice }: cancel
//
// A move picks its new time as a booking does, through GET /api/availability
// and POST /api/holds with `moving`.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { cancelVisit, changeableVisit, changeTerms, type ChangeTerms } from "../domain/visit-changes.ts";
import { clientOf, requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { requireSelfServe } from "../http/self-serve.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { BookingSchema, moveTermsFor, PriceSchema, startCheckout } from "./client-booking.ts";

const NoticeSchema = z
  .enum(["free", "late"])
  .openapi({ description: "free: more than 24 hours before the window starts; late: inside 24 hours." });

const termsOf = (terms: ChangeTerms) => ({
  visit_id: terms.visit.id,
  type: terms.visit.type,
  notice: terms.notice,
  free_until: terms.freeUntil.toISOString(),
  paid: terms.payment?.paid ?? 0,
  credit: terms.credit?.outcome ?? null,
});

const common = {
  visit_id: z.uuid(),
  type: z.enum(VISIT_TYPES),
  notice: NoticeSchema,
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
  })
  .strict()
  .openapi("CancelTerms");

const params = z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) });

const rescheduleRoute = createRoute({
  method: "post",
  path: "/api/appointments/{id}/reschedule",
  summary: "What moving a visit costs, or start the move a hold makes",
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              hold_id: z
                .uuid()
                .optional()
                .openapi({ description: "A hold made with `moving` for this visit; left out, the terms only." }),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: { description: "The terms", content: { "application/json": { schema: MoveTermsSchema } } },
    201: { description: "The move is started", content: { "application/json": { schema: BookingSchema } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such hold for moving this visit"),
    409: errorResponse("not_changeable; hold_expired; or ops_assisted"),
  },
});

const cancelRoute = createRoute({
  method: "post",
  path: "/api/appointments/{id}/cancel",
  summary: "What cancelling a visit gives back, or cancel it on those terms",
  request: {
    params,
    body: {
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
    401: errorResponse("session_required"),
    409: errorResponse(
      "not_changeable; terms_changed: the notice is not the one shown, so show the terms again; or ops_assisted",
    ),
    503: errorResponse("unavailable: FSM did not answer; nothing changed"),
  },
});

export function registerClientChanges(app: App): void {
  app.use("/api/appointments/*", requireClientSession);
  app.use("/api/appointments/*", requireSelfServe);

  app.openapi(rescheduleRoute, async (c) => {
    const session = clientOf(c);
    const visitId = c.req.valid("param").id;
    const holdId = c.req.valid("json").hold_id;
    if (holdId === undefined) {
      const move = await moveTermsFor(c, session.subjectId, visitId, null);
      if (move === null) return c.json(errorBody("not_changeable", c.var.requestId), 409);
      return c.json({ ...termsOf(move.terms), cost: move.terms.move.cost, price: move.terms.move.price }, 200);
    }
    const hold = await c.env.DB.prepare(
      "SELECT 1 FROM slot_holds WHERE id = ?1 AND person_id = ?2 AND moves_appointment_id = ?3",
    )
      .bind(holdId, session.subjectId, visitId)
      .first();
    if (hold === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const booking = await startCheckout(c, holdId, session.subjectId);
    if (booking === null) return c.json(errorBody("hold_expired", c.var.requestId), 409);
    return c.json(booking, 201);
  });

  app.openapi(cancelRoute, async (c) => {
    const session = clientOf(c);
    const { deps, requestId, log } = c.var;
    const now = deps.now();
    const visit = await changeableVisit(c.env.DB, session.subjectId, c.req.valid("param").id, now);
    if (visit === null) return c.json(errorBody("not_changeable", requestId), 409);
    const terms = await changeTerms(c.env.DB, visit, now);
    const body = c.req.valid("json");
    const shown = {
      ...termsOf(terms),
      refund: terms.cancel.refund,
      kept: terms.cancel.kept,
      destination: terms.payment?.method ?? null,
    };
    if (!body.confirm) return c.json({ ...shown, cancelled: false }, 200);
    if (body.notice !== terms.notice) return c.json(errorBody("terms_changed", requestId), 409);

    let outcome;
    try {
      const notify = (messageId: string) =>
        c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage);
      outcome = await cancelVisit(c.env.DB, { ...deps, notify }, terms, now, {
        labelAsTest: c.var.config.environment !== "production",
        log,
      });
    } catch (error) {
      log.error("cancel_failed", { appointment_id: visit.id, error });
      return c.json(errorBody("unavailable", requestId), 503);
    }
    if (outcome.kind === "not_changeable") return c.json(errorBody("not_changeable", requestId), 409);
    log.info("visit_cancelled", { appointment_id: visit.id, notice: terms.notice, refund: outcome.refund });
    return c.json({ ...shown, cancelled: true }, 200);
  });
}
