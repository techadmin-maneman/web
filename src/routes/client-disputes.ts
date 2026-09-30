// A client disputing a no-show's charge on one of their visits (src/domain/no-show-disputes.ts,
// docs/decisions/0096-a-no-shows-charge-and-its-dispute.md):
//
//   POST /api/visits/:id/dispute   { reason }: once a charge; ops rule Refund or Uphold in the console
//
// Every /api/visits/* route takes the client's session from src/routes/client-visits.ts, which is registered first
// (src/app.ts). Not behind SELF_SERVE_BOOKING: a charge can be disputed however the visit was booked.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { raiseDispute } from "../domain/no-show-disputes.ts";
import { clientOf } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { DISPUTE_REASON_MAX_CHARS } from "../policy/no-show.ts";

const DisputeRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(DISPUTE_REASON_MAX_CHARS).openapi({
      description: "Why the charge is wrong, in the client's words. Ops read it; it reaches no message.",
    }),
  })
  .strict()
  .openapi("NoShowDisputeRequest");

const disputeRoute = createRoute({
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
      "already_disputed: the charge was disputed before; or not_disputable: the charge took nothing to give back",
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
    if (raised.kind === "not_found") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (raised.kind === "not_disputable") return c.json(errorBody("not_disputable", c.var.requestId), 409);
    if (raised.kind === "already_disputed") return c.json(errorBody("already_disputed", c.var.requestId), 409);
    // The alert names the disputed visit, never the client or their words.
    await c.var.deps.alert(
      `A client disputed the no-show charge on visit ${appointmentId}; rule on it in the console.`,
    );
    return c.json({ state: "open" as const }, 201);
  });
}
