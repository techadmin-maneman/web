// A client's dispute of a no-show's charge, behind Access (Ops Console, board D1's "Disputed charge";
// src/domain/no-show-disputes.ts, docs/decisions/0096-a-no-shows-charge-and-its-dispute.md):
//   GET  /api/no-shows/disputes                  the disputes still to rule on, each with its case's evidence
//   POST /api/no-shows/disputes/:id/ruling       Refund or Uphold, with a reason
//
// Refunded gives back what the charge took, the money it kept and the credit it spent; upheld keeps them. Either
// way the client is told on WhatsApp, with their consent to messages about visits, never with ops' reason, which
// stays on the dispute.

import { createRoute, z } from "@hono/zod-openapi";
import { actorOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { openDisputes, ruleOnDispute } from "../domain/no-show-disputes.ts";
import { MESSAGE_STATES } from "../domain/no-shows.ts";
import { afterRuling } from "../domain/after-a-ruling.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { queueMessage } from "../http/queue-message.ts";
import { permitsOn, routeReach, withinRouteReach } from "../http/staff-access.ts";
import { REFUNDING_A_DISPUTE } from "../policy/console-routes.ts";
import { needsReason, REASON_MAX_CHARS } from "../policy/decision-reasons.ts";
import { DISPUTE_RULINGS } from "../policy/no-show.ts";
import { dueAt } from "../policy/tasks.ts";

/** As many as the board can usefully hold. */
const LIMIT = 50;

const DisputeSchema = z
  .object({
    id: z.uuid(),
    case_id: z.uuid(),
    appointment_id: z.uuid(),
    person: z.union([z.object({ id: z.uuid(), name: z.string(), mobile: z.string() }).strict(), z.null()]).openapi({
      description: "Whose visit it was, and the number to reach them on; null once they have been erased.",
    }),
    reason: z
      .union([z.string(), z.null()])
      .openapi({ description: "Why the client says the charge is wrong, in their words; null once erased." }),
    raised_at: z.iso.datetime(),
    due: z.iso.datetime().openapi({
      description: "When ops should have ruled: the Tasks board's allowance for a disputed charge, from raised_at.",
    }),
    kept: z.number().int().openapi({ description: "In paise: what the charge kept of the visit's payment." }),
    credit_spent: z.boolean().openapi({ description: "Whether the charge spent the credit the visit used." }),
    window_start: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When the visit was booked for." }),
    checked_in_at: z.iso.datetime().openapi({ description: "When he arrived, by his phone, held within bounds." }),
    phone_checked_in_at: z.union([z.iso.datetime(), z.null()]).openapi({
      description: "What the phone itself said, before the bounds; null when it said nothing.",
    }),
    received_at: z.iso.datetime(),
    distance_m: z.union([z.number().int(), z.null()]),
    radius_m: z.number().int().openapi({ description: "The check-in radius in force when he checked in." }),
    message_state: z.enum(MESSAGE_STATES).openapi({
      description:
        "What became of the day-before or arrival WhatsApp, as the no-show case reads it. none: nothing was queued; no_consent: not sent, the client never agreed to WhatsApp about visits; not_sent: skipped or failed; sent: no receipt came back; delivered.",
    }),
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
  summary: "Disputed no-show charges in the caller's cities still to rule on, oldest first, each with its evidence",
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
    403: errorResponse("access_required, or not_permitted: refunding asks Finance MANAGE in the dispute's city"),
    404: errorResponse("not_found: no such dispute in the caller's cities, or it was ruled on already"),
  },
});

export function registerOpsDisputes(app: App): void {
  app.openapi(disputesRoute, async (c) => {
    const reached = await routeReach(c);
    const [disputes, inputs] = await Promise.all([openDisputes(c.env.DB, LIMIT, reached), opsInputs(c)]);
    const due = (raisedAt: string) => dueAt(new Date(raisedAt), "no_show_dispute", inputs.taskSlaHours).toISOString();
    return c.json({ disputes: disputes.map((each) => ({ ...each, due: due(each.raised_at) })) }, 200);
  });

  app.openapi(rulingRoute, async (c) => {
    const staff = actorOf(c);
    const { id } = c.req.valid("param");
    const { ruling, reason } = c.req.valid("json");
    if (needsReason("no_show_dispute", ruling) && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", c.var.requestId, ["reason"]), 400);
    }
    if (!(await withinRouteReach(c, "dispute", id))) return c.json(errorBody("not_found", c.var.requestId), 404);
    if (ruling === "refunded" && !(await permitsOn(c, REFUNDING_A_DISPUTE, "dispute", id))) {
      return c.json(errorBody("not_permitted", c.var.requestId), 403);
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
    const notify = (messageId: string) => queueMessage(c, messageId);
    await afterRuling(c.env.DB, { ...c.var.deps, notify }, ruled);
    return c.json({ ruled: true }, 200);
  });
}
