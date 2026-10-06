// A technician's leave (./field.ts): what is still to end, each with the jobs booked on it; leave recorded, which
// the board and booking both refuse; and leave taken back.

import { createRoute, z } from "@hono/zod-openapi";
import { json } from "../../http/openapi.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { cancelLeave, LEAVE_MAX_DAYS, recordLeave, standingLeave } from "../../domain/dispatch/leave.ts";
import { rosterTechnician } from "../../domain/dispatch/technician-roster.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { withinRouteReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";

const LeaveRequestSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    note: z.string().min(1).max(200).optional().openapi({ description: "Why, in ops' words. Never a medical detail." }),
  })
  .strict()
  .openapi("TechnicianLeaveRequest");
const JobOnLeaveSchema = z
  .object({
    appointment_id: z.uuid(),
    starts_at: z.iso.datetime(),
    type: z.union([z.enum(VISIT_TYPES), z.null()]),
    client: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("TechnicianJobOnLeave", {
    description:
      "A job booked on a day the technician is away, which the leave moves nowhere: ops move it on the dispatch " +
      "board, and it waits on the Tasks board until they do.",
  });
const LeaveRecordedSchema = z
  .object({
    id: z.uuid(),
    jobs: z.array(JobOnLeaveSchema).openapi({ description: "The jobs already booked on those days, soonest first." }),
  })
  .strict()
  .openapi("TechnicianLeaveRecorded");
const StandingLeaveSchema = z
  .object({
    leave: z
      .array(
        z
          .object({
            id: z.uuid(),
            from: z.iso.date(),
            to: z.iso.date().openapi({ description: "Inclusive: a single day's leave has the same date twice." }),
            note: z.union([z.string(), z.null()]),
            jobs: z
              .array(JobOnLeaveSchema)
              .openapi({ description: "The jobs still booked on its days from today on, soonest first." }),
          })
          .strict(),
      )
      .openapi({ description: "His leave that has not ended yet, soonest first." }),
  })
  .strict()
  .openapi("TechnicianStandingLeave");

const standingLeaveRoute = createRoute({
  method: "get",
  path: "/api/technicians/{id}/leave",
  summary: "A technician's leave that has not ended, each with the jobs still booked on its days",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The leave", ...json(StandingLeaveSchema) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such technician, or he is outside the caller's cities"),
  },
});

const leaveRoute = createRoute({
  method: "post",
  path: "/api/technicians/{id}/leave",
  summary: "Record leave. Those days are then refused to booking and to the dispatch board alike",
  request: { params: z.object({ id: z.uuid() }), body: { required: true, ...json(LeaveRequestSchema) } },
  responses: {
    200: { description: "Recorded", ...json(LeaveRecordedSchema) },
    400: errorResponse(`invalid_request: to is before from, or more than ${String(LEAVE_MAX_DAYS)} days ahead`),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such active technician in the caller's cities"),
  },
});

const cancelLeaveRoute = createRoute({
  method: "post",
  path: "/api/technicians/{id}/leave/{leave}/cancel",
  summary: "Take leave back, so those days can be worked again",
  request: { params: z.object({ id: z.uuid(), leave: z.uuid() }) },
  responses: {
    200: { description: "Cancelled", ...json(z.object({ cancelled: z.boolean() }).strict()) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such leave of that technician's, or he is not in the caller's cities"),
  },
});

export function registerOpsTechnicianLeave(app: App): void {
  app.openapi(standingLeaveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const technician = await rosterTechnician(c.env.DB, id);
    if (technician === null || !(await withinRouteReach(c, "technician", id))) {
      return refuse(c, "not_found");
    }
    const periods = await standingLeave(c.env.DB, id, indiaDate(c.var.deps.now()));
    const leave = periods.map((period) => ({
      id: period.id,
      from: period.from,
      to: period.to,
      note: period.note,
      jobs: period.jobs,
    }));
    return c.json({ leave }, 200);
  });

  app.openapi(leaveRoute, async (c) => {
    const staff = actorOf(c);
    const { id } = c.req.valid("param");
    const { from, to, note } = c.req.valid("json");
    const now = c.var.deps.now();
    if (!(await withinRouteReach(c, "technician", id))) return refuse(c, "not_found");

    const outcome = await recordLeave({
      db: c.env.DB,
      leave: { technicianId: id, from, to, note: note ?? null, actor: staff.id },
      today: indiaDate(now),
      now,
      audit: {
        surface: "ops",
        actor: staff,
        action: "technician.leave",
        subject: { kind: "technician", id },
        requestId: c.var.requestId,
        detail: { from, to },
      },
    });
    if (outcome.kind === "no_such_technician") return refuse(c, "not_found");
    if (outcome.kind === "bad_dates") return refuse(c, "invalid_request", ["to"]);
    return c.json({ id: outcome.id, jobs: outcome.jobs }, 200);
  });

  app.openapi(cancelLeaveRoute, async (c) => {
    const staff = actorOf(c);
    const { id, leave } = c.req.valid("param");
    const now = c.var.deps.now();
    if (!(await withinRouteReach(c, "technician", id))) return refuse(c, "not_found");

    const cancelled = await cancelLeave(
      c.env.DB,
      {
        technicianId: id,
        leaveId: leave,
        actor: staff.id,
        audit: {
          surface: "ops",
          actor: staff,
          action: "technician.leave_cancelled",
          subject: { kind: "technician", id },
          requestId: c.var.requestId,
          detail: { leave_id: leave },
        },
      },
      now,
    );
    if (!cancelled) return refuse(c, "not_found");
    return c.json({ cancelled: true }, 200);
  });
}
