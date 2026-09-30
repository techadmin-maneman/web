// A client's dispute of a no-show's charge, behind Access (Ops Console, board D1's "Disputed charge";
// src/domain/no-show-disputes.ts, docs/decisions/0096-a-no-shows-charge-and-its-dispute.md):
//   GET  /api/no-shows/disputes                  the disputes still to rule on, each with its case's evidence
//   POST /api/no-shows/disputes/:id/ruling       Refund or Uphold, with a reason
//
// Refunded gives back what the charge took, the money it kept and the credit it spent; upheld keeps them. Either
// way the client is told on WhatsApp, with their consent to messages about visits, never with ops' reason, which
// stays on the dispute.

import { createRoute, z } from "@hono/zod-openapi";
import { staffOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { openDisputes, ruleOnDispute } from "../domain/no-show-disputes.ts";
import { alertCreditNotBack, refundNoShow } from "../domain/no-shows.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { needsReason, REASON_MAX_CHARS } from "../policy/decision-reasons.ts";
import { DISPUTE_RULINGS } from "../policy/no-show.ts";
import { dueAt } from "../policy/tasks.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

/** As many as the board can usefully hold. */
const LIMIT = 50;

const DisputeSchema = z
  .object({
    id: z.uuid(),
    case_id: z.uuid(),
    appointment_id: z.uuid(),
    person: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Whose visit it was; null once they have been erased." }),
    reason: z
      .union([z.string(), z.null()])
      .openapi({ description: "Why the client says the charge is wrong, in their words; null once erased." }),
    raised_at: z.iso.datetime(),
    due: z.iso.datetime().openapi({
      description: "When ops should have ruled: the Tasks board's allowance for a no-show, from raised_at.",
    }),
    kept: z.number().int().openapi({ description: "In paise: what the charge kept of the visit's payment." }),
    credit_spent: z.boolean().openapi({ description: "Whether the charge spent the credit the visit used." }),
    window_start: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When the visit was booked for." }),
    checked_in_at: z.iso.datetime(),
    received_at: z.iso.datetime(),
    distance_m: z.union([z.number().int(), z.null()]),
    radius_m: z.number().int().openapi({ description: "The check-in radius in force when he checked in." }),
    message_delivered_at: z.union([z.iso.datetime(), z.null()]),
    closed_at: z.union([z.iso.datetime(), z.null()]),
  })
  .strict()
  .openapi("NoShowDispute", { description: "A disputed charge, with the evidence its no-show was ruled on." });

const RulingRequestSchema = z
  .object({
    ruling: z.enum(DISPUTE_RULINGS),
    reason: z.string().trim().max(REASON_MAX_CHARS).nullable().openapi({
      description: "Required either way, and kept on the dispute (src/policy/decision-reasons.ts).",
    }),
  })
  .strict()
  .openapi("NoShowDisputeRuling");

const disputesRoute = createRoute({
  method: "get",
  path: "/api/no-shows/disputes",
  summary: "Disputed no-show charges still to rule on, oldest first, each with its evidence",
  responses: {
    200: { description: "The disputes", ...json(z.object({ disputes: z.array(DisputeSchema) }).strict()) },
    403: errorResponse("access_required"),
  },
});

const rulingRoute = createRoute({
  method: "post",
  path: "/api/no-shows/disputes/{id}/ruling",
  summary: "Refund or uphold a disputed no-show charge, with a reason",
  request: { params: z.object({ id: z.uuid() }), body: { required: true, ...json(RulingRequestSchema) } },
  responses: {
    200: { description: "Recorded", ...json(z.object({ ruled: z.boolean() }).strict()) },
    400: errorResponse("invalid_request: a ruling needs a reason"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such dispute, or it was ruled on already"),
  },
});

export function registerOpsDisputes(app: App): void {
  app.openapi(disputesRoute, async (c) => {
    const [disputes, inputs] = await Promise.all([openDisputes(c.env.DB, LIMIT), opsInputs(c)]);
    const due = (raisedAt: string) => dueAt(new Date(raisedAt), "no_show_decision", inputs.taskSlaHours).toISOString();
    return c.json({ disputes: disputes.map((each) => ({ ...each, due: due(each.raised_at) })) }, 200);
  });

  app.openapi(rulingRoute, async (c) => {
    const staff = staffOf(c);
    const { id } = c.req.valid("param");
    const { ruling, reason } = c.req.valid("json");
    if (needsReason("no_show_dispute", ruling) && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", c.var.requestId, ["reason"]), 400);
    }

    const ruled = await ruleOnDispute(c.env.DB, {
      disputeId: id,
      ruling,
      reason: reason ?? "",
      actor: staff.id,
      audit: {
        surface: "ops",
        actor: staff,
        action: "no_show.dispute_rule",
        subject: { kind: "no_show_dispute", id },
        requestId: c.var.requestId,
        detail: { ruling },
      },
      now: c.var.deps.now(),
    });
    if (ruled === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    if (ruled.refund !== null) await refundNoShow(c.env.DB, c.var.deps, ruled.refund);
    if (ruled.creditNotBack !== null) await alertCreditNotBack(c.var.deps.alertOnce, ruled.creditNotBack);
    if (ruled.messageId !== null) {
      await c.env.MESSAGE_QUEUE.send({
        message_id: ruled.messageId,
        request_id: c.var.requestId,
      } satisfies MessagingMessage);
    }
    return c.json({ ruled: true }, 200);
  });
}
