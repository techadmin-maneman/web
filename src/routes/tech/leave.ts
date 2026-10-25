// A technician's asks for leave from their phone (src/domain/dispatch/leave-requests.ts): each ask and where it stands,
// and a new one, which Operations decide on Tasks. Their own alone.

import { z } from "@hono/zod-openapi";
import { requestLeave, requestsOf } from "../../domain/dispatch/leave-requests.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { indiaDate } from "../../lib/india-time.ts";

const LeaveRequestsSchema = z
  .object({
    requests: z.array(
      z
        .object({
          id: z.uuid(),
          from: z.iso.date(),
          to: z.iso.date().openapi({ description: "Counted, as the first day is." }),
          note: z.union([z.string(), z.null()]),
          state: z.enum(["asked", "approved", "declined"]),
          requested_at: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("TechnicianLeaveRequests", { description: "The asks not yet past, the latest first." });

const LeaveAskSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    note: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .openapi({ description: "Why, in a line; never a medical detail." }),
  })
  .strict()
  .openapi("TechnicianLeaveAsk");

const SESSION_REFUSED = errorResponse(
  "session_required; device_revoked; technician_inactive: ops switched the technician off",
);

const listRoute = techRoute({
  method: "get",
  path: "/api/tech/leave",
  summary: "The technician's asks for leave not yet past, and where each stands",
  responses: { 200: { description: "The asks", ...json(LeaveRequestsSchema) }, 401: SESSION_REFUSED },
});

const askRoute = techRoute({
  method: "post",
  path: "/api/tech/leave",
  summary: "Ask for leave, from today on; Operations decide it on Tasks",
  request: { body: { required: true, ...json(LeaveAskSchema) } },
  responses: {
    201: { description: "Asked, and every ask as it now stands", ...json(LeaveRequestsSchema) },
    400: errorResponse("invalid_request: from before today, to before from, or further ahead than leave is kept"),
    401: SESSION_REFUSED,
  },
});

export function registerTechLeave(app: App): void {
  app.openapi(listRoute, async (c) => {
    const today = indiaDate(c.var.deps.now());
    return c.json({ requests: await requestsOf(c.env.DB, technicianOf(c).technicianId, today) }, 200);
  });

  app.openapi(askRoute, async (c) => {
    const { from, to, note } = c.req.valid("json");
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const { technicianId } = technicianOf(c);
    const asked = await requestLeave(c.env.DB, { technicianId, from, to, note: note ?? null, today, now });
    if (asked === "bad_dates") return refuse(c, "invalid_request", ["to"]);
    return c.json({ requests: await requestsOf(c.env.DB, technicianId, today) }, 201);
  });
}
