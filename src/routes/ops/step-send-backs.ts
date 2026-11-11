// Ops sending a landed step back to the visit's technician, with why (docs/decisions/0246-closed-and-sent-back.md),
// from the visit's drawer on the dispatch board, behind Access (Operations · Act). A visit outside the caller's cities
// is answered as one that does not exist.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { sendBackStep } from "../../domain/field/step-send-backs.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { withinRouteReach } from "../../http/staff-access.ts";
import { REASON_MAX_CHARS } from "../../policy/decision-reasons.ts";
import { SENT_BACK_KINDS } from "../../policy/in-job-steps.ts";

const sendBackRoute = opsRoute({
  method: "post",
  path: "/api/visits/{id}/send-back",
  summary: "Send a landed step back to the visit's technician, with why: their phone opens it again",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            step: z.enum(SENT_BACK_KINDS).openapi({
              description: "The step: a set of photographs, the checklist, or the consumables.",
            }),
            reason: z.string().trim().max(REASON_MAX_CHARS).openapi({
              description: "Why, as ops write it: shown to the technician on the step.",
            }),
          })
          .strict()
          .openapi("SendBack"),
      ),
    },
  },
  responses: {
    204: { description: "Sent back: the step lands again, even after the close" },
    400: errorResponse("invalid_request: no reason"),
    404: errorResponse("not_found: no such visit in the caller's cities, or a step it cannot send back"),
    409: errorResponse("not_changeable: the step has not landed, or it is sent back already"),
  },
});

export function registerOpsStepSendBacks(app: App): void {
  app.openapi(sendBackRoute, async (c) => {
    const visitId = c.req.valid("param").id;
    const { step, reason } = c.req.valid("json");
    if (reason === "") return refuse(c, "invalid_request", ["reason"]);
    if (!(await withinRouteReach(c, "visit", visitId))) return refuse(c, "not_found");
    const actor = actorOf(c);
    const sent = await sendBackStep(c.env.DB, {
      appointmentId: visitId,
      kind: step,
      reason,
      by: actor.id,
      audit: { surface: "ops", actor, requestId: c.var.requestId },
      now: c.var.deps.now(),
    });
    if (sent === "not_found") return refuse(c, "not_found");
    if (sent !== "sent") return refuse(c, "not_changeable");
    c.var.log.info("visit_step_sent_back", { appointment_id: visitId, step });
    return c.body(null, 204);
  });
}
