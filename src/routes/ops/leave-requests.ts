// Operations' decision on a technician's ask for leave, from its task (src/domain/dispatch/leave-requests.ts): an
// approval records the leave as ops record it on the technician's page, a decline only the decision. Behind Access,
// within the caller's places.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { decideLeaveRequest } from "../../domain/dispatch/leave-requests.ts";
import { auditStatement } from "../../domain/platform/audit.ts";
import { staffMemberOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { withinRouteReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";

const decisionRoute = opsRoute({
  method: "post",
  path: "/api/leave-requests/{id}/decision",
  summary: "Approve or decline a technician's ask for leave; an approval records the leave",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({ decision: z.enum(["approved", "declined"]) })
          .strict()
          .openapi("LeaveDecision"),
      ),
    },
  },
  responses: {
    204: { description: "Decided" },
    403: errorResponse("access_required: no Access token, or a service token, which names no member of staff"),
    404: errorResponse("not_found: no such ask in the caller's places"),
    409: errorResponse("superseded: another member of staff decided it first"),
  },
});

export function registerOpsLeaveRequests(app: App): void {
  app.openapi(decisionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { decision } = c.req.valid("json");
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    if (!(await withinRouteReach(c, "leave_request", id))) return refuse(c, "not_found");
    const now = c.var.deps.now();
    const decided = await decideLeaveRequest(c.env.DB, {
      id,
      decision,
      staff: staff.id,
      today: indiaDate(now),
      now,
      audit: {
        surface: "ops",
        actor: staff,
        action: "technician.leave",
        subject: { kind: "leave_request", id },
        requestId: c.var.requestId,
      },
    });
    if (decided === "gone") return refuse(c, "superseded");
    if (decision === "declined") {
      const entry = {
        surface: "ops" as const,
        actor: staff,
        action: "technician.leave_declined" as const,
        subject: { kind: "leave_request", id },
        requestId: c.var.requestId,
      };
      await auditStatement(c.env.DB, entry, now).run();
    }
    return c.body(null, 204);
  });
}
