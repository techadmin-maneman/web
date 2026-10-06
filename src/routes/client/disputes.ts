// A client disputing a no-show's charge on one of their visits (src/domain/no-shows/no-show-disputes.ts,
// docs/decisions/0096-a-no-shows-charge-and-its-dispute.md):
//
//   POST /api/visits/:id/dispute   { reason }: once a charge; ops rule Refund or Uphold in the console
//
// Not behind SELF_SERVE_BOOKING: a charge can be disputed however the visit was booked.

import { z } from "@hono/zod-openapi";
import { clientRoute } from "../../http/session-routes.ts";
import type { App } from "../../http/context.ts";
import { raiseDispute } from "../../domain/no-shows/no-show-disputes.ts";
import { clientOf } from "../../http/client-session.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { DISPUTE_REASON_MAX_CHARS } from "../../policy/no-show.ts";

const DisputeRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(DISPUTE_REASON_MAX_CHARS).openapi({
      description: "Why the charge is wrong, in the client's words. Ops read it; it reaches no message.",
    }),
  })
  .strict()
  .openapi("NoShowDisputeRequest");

const disputeRoute = clientRoute({
  method: "post",
  path: "/api/visits/{id}/dispute",
  summary: "Dispute the no-show's charge on a visit, once",
  request: {
    params: z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) }),
    body: { required: true, ...json(DisputeRequestSchema) },
  },
  responses: {
    201: {
      description: "Raised, for ops to rule on",
      ...json(
        z
          .object({ state: z.literal("open") })
          .strict()
          .openapi("NoShowDisputeRaised"),
      ),
    },
    400: errorResponse(`invalid_request: an empty reason, or one over ${String(DISPUTE_REASON_MAX_CHARS)} characters`),
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no charged no-show on a visit of this client's"),
    409: errorResponse(
      "already_disputed: the charge was disputed before; not_disputable: the charge took nothing to give back; or " +
        "dispute_window_closed: the days the charge could be disputed are past",
    ),
  },
});

export function registerClientDisputes(app: App): void {
  app.openapi(disputeRoute, async (c) => {
    const session = clientOf(c);
    const appointmentId = c.req.valid("param").id;

    const raised = await raiseDispute(c.env.DB, {
      personId: session.subjectId,
      appointmentId,
      reason: c.req.valid("json").reason,
      now: c.var.deps.now(),
      audit: (disputeId) => ({
        surface: "client",
        actor: { kind: "client", id: session.subjectId },
        action: "no_show.dispute",
        subject: { kind: "no_show_dispute", id: disputeId },
        requestId: c.var.requestId,
      }),
    });
    if (raised.kind === "not_found") return refuse(c, "not_found");
    if (raised.kind === "not_disputable") return refuse(c, "not_disputable");
    if (raised.kind === "window_closed") return refuse(c, "dispute_window_closed");
    if (raised.kind === "already_disputed") return refuse(c, "already_disputed");
    // The alert names the disputed visit, never the client or their words.
    await c.var.deps.alert(
      `A client disputed the no-show charge on visit ${appointmentId}; rule on it in the console.`,
    );
    return c.json({ state: "open" as const }, 201);
  });
}
