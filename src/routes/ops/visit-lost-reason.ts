// Why a client is not going ahead after their consultation, set or cleared on the client's page, behind Access
// (Customer Care; docs/decisions/0149-lost-reasons.md):
//   POST /api/visits/:id/lost-reason   { lost_reason: a code from the job sheet's list, or null to clear it }
//
// It keeps to the caller's cities: a visit elsewhere is answered as one that does not exist.

import { createRoute, z } from "@hono/zod-openapi";
import { setLostReason } from "../../domain/visits/lost-reasons.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { withinRouteReach } from "../../http/staff-access.ts";

const lostReasonRoute = createRoute({
  method: "post",
  path: "/api/visits/{id}/lost-reason",
  summary: "Set, or clear, why a client is not going ahead with a fit after this consultation",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            lost_reason: z.union([z.string().min(1).max(64), z.null()]).openapi({
              description: "One of the job sheet's lost_reasons, by its code; null where they are going ahead.",
            }),
          })
          .strict()
          .openapi("LostReasonChange"),
      ),
    },
  },
  responses: {
    200: { description: "Kept", ...json(z.object({ lost_reason: z.union([z.string(), z.null()]) }).strict()) },
    400: errorResponse("invalid_request: fields names lost_reason for a code the job sheet never listed"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no closed consultation by this id in the caller's cities"),
  },
});

export function registerOpsVisitLostReason(app: App): void {
  app.openapi(lostReasonRoute, async (c) => {
    const visitId = c.req.valid("param").id;
    const reason = c.req.valid("json").lost_reason;
    if (!(await withinRouteReach(c, "visit", visitId))) return refuse(c, "not_found");
    const set = await setLostReason(c.env.DB, {
      appointmentId: visitId,
      reason,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (set === "not_found") return refuse(c, "not_found");
    if (set === "unknown_reason") return refuse(c, "invalid_request", ["lost_reason"]);
    return c.json({ lost_reason: reason }, 200);
  });
}
