// The technician asks ops to move a visit, with why (src/domain/dispatch/reschedule-requests.ts): asked straight, with
// signal, as a suggestion to finish a visit is, so they hear at once that ops have it.

import { z } from "@hono/zod-openapi";
import { askToReschedule, RESCHEDULE_REASONS } from "../../domain/dispatch/reschedule-requests.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { RescheduleAskedSchema } from "../schemas/reschedule.ts";

const rescheduleRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/reschedule-request",
  summary: "Ask ops to move the visit, with why: a task on their board until they settle it",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            reason: z.enum(RESCHEDULE_REASONS).openapi({
              description: "The client asked, the technician is running late, or a problem with the kit.",
            }),
          })
          .strict()
          .openapi("TechnicianRescheduleRequest"),
      ),
    },
  },
  responses: {
    200: { description: "The ask that stands, new or already open", ...json(RescheduleAskedSchema) },
    401: errorResponse("session_required; device_revoked; technician_inactive: ops switched the technician off"),
    404: errorResponse("not_found: no such job of this technician's"),
    409: errorResponse("not_changeable: the visit is closed or called off"),
  },
});

export function registerTechReschedule(app: App): void {
  app.openapi(rescheduleRoute, async (c) => {
    const appointmentId = c.req.valid("param").id;
    const asked = await askToReschedule(c.env.DB, {
      appointmentId,
      technicianId: technicianOf(c).technicianId,
      reason: c.req.valid("json").reason,
      now: c.var.deps.now(),
    });
    if (asked === "not_found" || asked === "not_changeable") return refuse(c, asked);
    c.var.log.info("reschedule_requested", { appointment_id: appointmentId, reason: asked.reason });
    return c.json(asked, 200);
  });
}
