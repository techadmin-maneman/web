// The dispatch board on the ops console, behind Access (Ops Console, board A;
// src/policy/dispatch.ts):
//   GET  /api/dispatch?from=&city=   the grid, blocks, unassigned tray, leave and utilisation
//   GET  /api/dispatch/version       whether anything the board draws has changed since it was read
//   GET  /api/dispatch/room?appointment_id=&from=   where a job in hand would land this week
//   POST /api/dispatch/assign        put an unassigned job on a technician
//   POST /api/dispatch/move          move a job, with a reason from the design's list
//   POST /api/dispatch/moves/:id/told   ops called a client who had not heard of a move
//
// Each keeps to the caller's cities: the board shows their visits and technicians, and a visit or move elsewhere is
// not found.
//
// Both writes run the clash check, then move the visit and message the client
// with his new window, in one batch. A visit the technician has begun is not
// moved, unless he has only checked in
// and ops choose to clear his check-in. "The client's payment carries over and
// he is never charged for a move ops make", so no amount appears anywhere
// below.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import type { AuditEntry } from "../domain/audit.ts";
import {
  BOARD_DAYS,
  boardVersion,
  dispatchBoard,
  moveJob,
  recordToldByPhone,
  roomFor,
  type MoveInput,
} from "../domain/dispatch.ts";
import { isWithin, techniciansWithin } from "../domain/places.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { json } from "../http/openapi.ts";
import { queueMessage } from "../http/queue-message.ts";
import { routeReach, withinRouteReach } from "../http/staff-access.ts";
import { indiaDate } from "../lib/india-time.ts";
import { BEGUN, CLIENT_NOTICES, MOVE_REASONS, UNTOLD_REASONS } from "../policy/dispatch.ts";
import { PAYMENT_BADGES } from "../policy/job-visibility.ts";

const ClientSchema = z
  .object({
    id: z.uuid(),
    name: z.string().openapi({ description: "In full, as the drawer heads it." }),
    mobile: z.string().openapi({ description: "E.164, for WhatsApp and for a call." }),
    whatsapp_visits: z.boolean().openapi({
      description: "His latest word on WhatsApp about his visits is yes, so a move's new window reaches him there.",
    }),
    referred_by: z
      .union([z.string(), z.null()])
      .openapi({ description: "Who invited him, by name; null when he came on his own." }),
  })
  .strict()
  .openapi("DispatchClient");

/** What every job carries, on a technician's day or in the tray. */
const VISIT = {
  appointment_id: z.uuid(),
  type: z.union([z.enum(VISIT_TYPES), z.null()]),
  service: z.union([z.string(), z.null()]).openapi({
    description:
      "The service's name in the console, where it names more than the visit's kind: a first fit's hair system, " +
      "say. Null for a kind's standard service, and on a consultation and fit in one visit until the client chooses.",
  }),
  client: z.union([z.string(), z.null()]).openapi({ description: "First name and last initial." }),
  sector: z.union([z.string(), z.null()]).openapi({
    description: "The area the visit's pincode is in, from the service area; else the address's locality, or the city.",
  }),
  pincode: z.union([z.string(), z.null()]),
  person: z.union([ClientSchema, z.null()]).openapi({
    description: "Null for a visit with no client on our records, and for a client who has been erased.",
  }),
  badge: z.enum(PAYMENT_BADGES).openapi({ description: "Never an amount: prepaid, credit, or free." }),
  slots: z.number().openapi({ description: "Consultation 1, service 1, replacement 1.5, first fit 2." }),
  starts_at: z.iso.datetime(),
};

const BlockSchema = z
  .object({
    ...VISIT,
    window: z.enum(BOOKING_WINDOWS),
    status: z.enum(["scheduled", "dispatched", "in_progress", "completed", "cancelled", "terminated", "other"]),
    notice_hours: z.number().int().openapi({
      description:
        "The notice the visit was sold under, in hours, or the one in force for a visit no hold sold: a change of the client's own inside it costs them, one ops make never does.",
    }),
    untold: z
      .union([
        z.object({ move_id: z.uuid(), starts_at: z.iso.datetime(), reason: z.enum(UNTOLD_REASONS) }).strict(),
        z.null(),
      ])
      .openapi({
        description:
          "The latest move of this visit its client has not heard of, and why. no_consent: he has not agreed to WhatsApp about his visits; not_sent: the WhatsApp was skipped or failed. Ops call him, then POST /api/dispatch/moves/{id}/told.",
      }),
    begun: z.union([z.enum(BEGUN), z.null()]).openapi({
      description:
        "How far the technician has got, from the steps his phone sent: arrived (checked in), started, or closed (an outcome, a no-show among them). Null before he arrives. A visit he has begun, or one in progress, is not moved.",
    }),
  })
  .strict()
  .openapi("DispatchBlock");

const VERSION = z.number().int().openapi({
  description:
    "Goes up whenever a visit, a move, leave, a technician or the day's slot times change. The board reads itself again when GET /api/dispatch/version answers another.",
});

const BoardSchema = z
  .object({
    version: VERSION,
    from: z.iso.date(),
    dates: z.array(z.iso.date()).openapi({ description: `${String(BOARD_DAYS)} days, the board's columns.` }),
    city: z.union([z.string(), z.null()]).openapi({ description: "The city the jobs are narrowed to; null for all." }),
    cities: z.array(z.string()).openapi({ description: "The cities the board can be narrowed to: the caller's." }),
    technicians: z.array(
      z
        .object({
          technician_id: z.uuid(),
          name: z.string(),
          initials: z.string(),
          zone: z.union([z.string(), z.null()]),
          days: z.array(z.object({ date: z.iso.date(), blocks: z.array(BlockSchema) }).strict()),
        })
        .strict(),
    ),
    unassigned: z.array(
      z
        .object({
          ...VISIT,
          asked_window: z.union([z.enum(BOOKING_WINDOWS), z.null()]).openapi({
            description:
              "The window the client asked for, from the Request behind the visit; null where nothing recorded one.",
          }),
          offered_window: z.union([z.enum(BOOKING_WINDOWS), z.null()]),
          date: z.union([z.iso.date(), z.null()]),
          was_technician: z.union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()]).openapi({
            description:
              "The technician the job is still on, who was switched off and so has no row; null for a job nobody " +
              "holds. A move of it names him as the expected technician.",
          }),
        })
        .strict(),
    ),
    utilisation: z.array(z.object({ date: z.iso.date(), percent: z.number().int() }).strict()).openapi({
      description:
        "Each column's utilisation, in per cent: the slots the day's jobs take, done or still to do, out of the slots of the technicians not on leave. Written to events daily as well.",
    }),
    leave: z
      .array(
        z
          .object({
            technician_id: z.uuid(),
            from: z.iso.date(),
            to: z.iso.date(),
            note: z.union([z.string(), z.null()]),
          })
          .strict(),
      )
      .openapi({
        description: "Leave ops recorded, clipped to this week.",
      }),
  })
  .strict()
  .openapi("DispatchBoard");

/**
 * The job as the board the move was made from showed it. If either differs from the job now, another ops user
 * has moved it since, and nothing is written (FEO-05).
 */
const EXPECTED = {
  expected_technician_id: z
    .union([z.uuid(), z.null()])
    .openapi({ description: "The technician the board showed the job with; null for a job in the tray." }),
  expected_starts_at: z.iso.datetime().openapi({ description: "The start the board showed the job with." }),
};

const AssignRequestSchema = z
  .object({
    appointment_id: z.uuid(),
    technician_id: z.uuid(),
    date: z.iso.date().optional(),
    window: z.enum(BOOKING_WINDOWS).optional(),
    reason: z.enum(MOVE_REASONS),
    ...EXPECTED,
  })
  .strict()
  .openapi("DispatchAssignRequest");

const MoveRequestSchema = z
  .object({
    appointment_id: z.uuid(),
    technician_id: z.uuid().optional().openapi({ description: "Left out keeps the technician it has." }),
    date: z.iso.date().optional(),
    window: z.enum(BOOKING_WINDOWS).optional(),
    reason: z.enum(MOVE_REASONS),
    ...EXPECTED,
    clear_check_in: z.literal(true).optional().openapi({
      description:
        "Ops were warned that the technician has checked in, and move the visit anyway: his check-in is cleared, and he checks in again at the new time. The audit log names who chose it. Without it, a visit he has checked in at answers 409 in_progress.",
    }),
  })
  .strict()
  .openapi("DispatchMoveRequest");

const MovedSchema = z
  .object({
    move_id: z.uuid(),
    client_notice: z.enum(CLIENT_NOTICES).openapi({
      description:
        "messaged: the new window was queued to go on WhatsApp; call: the client has not agreed to WhatsApp about his visits, so ops call him, and a task waits until they say they have; unchanged: only the technician changed, so there was nothing to tell; no_client: the visit has no client on our records.",
    }),
  })
  .strict()
  .openapi("DispatchMoved");

const boardRoute = createRoute({
  method: "get",
  path: "/api/dispatch",
  summary:
    "The dispatch board: seven days of the visits and active technicians in the caller's cities, with the unassigned tray",
  request: { query: z.object({ from: z.iso.date().optional(), city: z.string().min(1).max(60).optional() }) },
  responses: {
    200: { description: "The board", ...json(BoardSchema) },
    403: errorResponse("access_required"),
  },
});

const versionRoute = createRoute({
  method: "get",
  path: "/api/dispatch/version",
  summary:
    "The board's version, which the open board asks for every minute: one row, where the board itself is hundreds",
  responses: {
    200: {
      description: "The version now",
      ...json(z.object({ version: VERSION }).strict().openapi("DispatchBoardVersion")),
    },
    403: errorResponse("access_required"),
  },
});

const assignRoute = createRoute({
  method: "post",
  path: "/api/dispatch/assign",
  summary: "Put a job on a technician, with a reason. The clash check runs before anything is written",
  request: { body: { required: true, ...json(AssignRequestSchema) } },
  responses: {
    200: { description: "Assigned", ...json(MovedSchema) },
    400: errorResponse("invalid_request: fields names technician_id for one not in the caller's cities"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such live job in the caller's cities"),
    409: errorResponse(
      "clash: the technician already holds a job in that window on that date; on_leave: they are away that day; does_not_fit: the window is free but the visit has no room in it; superseded: the job is not as the board showed it, and fields names what changed (technician, time, or moving: another move of it is being written); in_progress: a technician has begun the visit",
    ),
  },
});

const moveRoute = createRoute({
  method: "post",
  path: "/api/dispatch/move",
  summary: "Move a job to another technician, day or window, with a reason. The client is never charged",
  request: { body: { required: true, ...json(MoveRequestSchema) } },
  responses: {
    200: { description: "Moved, and the client told", ...json(MovedSchema) },
    400: errorResponse(
      "invalid_request, including a move to the technician, day and window the job already has, or to a technician not in the caller's cities",
    ),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such live job in the caller's cities"),
    409: errorResponse(
      "clash; on_leave; does_not_fit; superseded, with what changed in fields; in_progress: the technician has begun the visit. One he has only checked in at moves with clear_check_in; one he has started or closed stays where it is",
    ),
  },
});

const RoomSchema = z
  .object({
    appointment_id: z.uuid(),
    rooms: z.array(
      z
        .object({
          technician_id: z.uuid(),
          date: z.iso.date(),
          windows: z.array(z.enum(BOOKING_WINDOWS)).min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("DispatchRoom", {
    description:
      "Each technician's day in the caller's cities with a window the job would land in, by the check a move runs. A day not listed has none. Not where the job already is.",
  });

const roomRoute = createRoute({
  method: "get",
  path: "/api/dispatch/room",
  summary: "Where a job in hand can go in the board's week, before ops pick a reason. Writes nothing",
  request: { query: z.object({ appointment_id: z.uuid(), from: z.iso.date().optional() }) },
  responses: {
    200: { description: "Where it would land", ...json(RoomSchema) },
    403: errorResponse("access_required"),
    404: errorResponse(
      "not_found: no such live job in the caller's cities, or one the technician has started or closed, which stays where it is",
    ),
  },
});

const toldRoute = createRoute({
  method: "post",
  path: "/api/dispatch/moves/{id}/told",
  summary: "Ops called the client about a move he had not heard of; its task leaves the board",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Recorded", ...json(z.object({ told: z.literal(true) }).strict()) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no move of a live visit in the caller's cities whose client is still to be told"),
  },
});

export function registerOpsDispatch(app: App): void {
  app.openapi(boardRoute, async (c) => {
    const now = c.var.deps.now();
    const { from, city } = c.req.valid("query");
    const [inputs, reach] = await Promise.all([opsInputs(c), routeReach(c)]);
    const noticeHours = inputs.changeNoticeHours;
    return c.json(
      await dispatchBoard(c.env.DB, { from: from ?? indiaDate(now), city: city ?? null, noticeHours, reach }),
      200,
    );
  });

  app.openapi(versionRoute, async (c) => c.json({ version: await boardVersion(c.env.DB) }, 200));

  app.openapi(roomRoute, async (c) => {
    const now = c.var.deps.now();
    const { appointment_id: appointmentId, from } = c.req.valid("query");
    if (!(await withinRouteReach(c, "visit", appointmentId)))
      return c.json(errorBody("not_found", c.var.requestId), 404);
    const rooms = await roomFor(c.env.DB, { appointmentId, from: from ?? indiaDate(now) }, now);
    if (rooms === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const technicians = await techniciansWithin(c.env.DB, await routeReach(c));
    const reached = rooms.filter((room) => isWithin(technicians, room.technician_id));
    return c.json({ appointment_id: appointmentId, rooms: reached }, 200);
  });

  app.openapi(assignRoute, (c) => write(c, c.req.valid("json")));
  app.openapi(moveRoute, (c) => write(c, c.req.valid("json")));

  app.openapi(toldRoute, async (c) => {
    const { requestId, deps } = c.var;
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "move", id))) return c.json(errorBody("not_found", requestId), 404);
    const actor = staffOf(c);
    const recorded = await recordToldByPhone(c.env.DB, {
      moveId: id,
      actor: actor.id,
      audit: {
        surface: "ops",
        actor,
        action: "dispatch.client_told",
        subject: { kind: "dispatch_move", id },
        requestId,
      },
      now: deps.now(),
    });
    if (!recorded) return c.json(errorBody("not_found", requestId), 404);
    return c.json({ told: true as const }, 200);
  });
}

type MoveRequest = z.infer<typeof MoveRequestSchema>;

/** The technician a job goes to: one in the caller's cities, or the one the board showed it with. */
async function mayGoTo(c: Context<AppEnv>, request: MoveRequest): Promise<boolean> {
  const named = request.technician_id;
  if (named === undefined || named === request.expected_technician_id) return true;
  return withinRouteReach(c, "technician", named);
}

/** The audit entry for clearing the technician's check-in, under whoever chose it; null for an ordinary move. */
function checkInClearedBy(c: Context<AppEnv>, request: MoveRequest): AuditEntry | null {
  if (request.clear_check_in !== true) return null;
  return {
    surface: "ops",
    actor: staffOf(c),
    action: "dispatch.check_in_cleared",
    subject: { kind: "appointment", id: request.appointment_id },
    requestId: c.var.requestId,
  };
}

/** Assigning and moving are the same write; only what ops change differs. */
async function write(c: Context<AppEnv>, request: MoveRequest) {
  const { requestId, deps, log } = c.var;
  const staff = staffOf(c);
  if (!(await withinRouteReach(c, "visit", request.appointment_id))) {
    return c.json(errorBody("not_found", requestId), 404);
  }
  if (!(await mayGoTo(c, request))) return c.json(errorBody("invalid_request", requestId, ["technician_id"]), 400);

  const input: MoveInput = {
    appointmentId: request.appointment_id,
    technicianId: request.technician_id ?? null,
    date: request.date ?? null,
    window: request.window ?? null,
    reason: request.reason,
    actor: staff.id,
    expected: { technicianId: request.expected_technician_id, startsAt: request.expected_starts_at },
    clearCheckIn: checkInClearedBy(c, request),
  };
  const outcome = await moveJob(
    c.env.DB,
    {
      notify: (messageId) => queueMessage(c, messageId),
    },
    input,
    deps.now(),
  );

  if (outcome.kind === "not_found") return c.json(errorBody("not_found", requestId), 404);
  if (outcome.kind === "superseded") return c.json(errorBody("superseded", requestId, outcome.changed), 409);
  if (outcome.kind === "in_progress") return c.json(errorBody("in_progress", requestId), 409);
  if (outcome.kind === "nothing_to_move") {
    return c.json(errorBody("invalid_request", requestId, ["technician_id", "date", "window"]), 400);
  }
  if (outcome.kind === "no_technician") return c.json(errorBody("invalid_request", requestId, ["technician_id"]), 400);
  if (outcome.kind === "refused") return c.json(errorBody(outcome.reason, requestId), 409);
  log.info("dispatch_moved", { appointment_id: input.appointmentId, move_id: outcome.moveId, reason: input.reason });
  return c.json({ move_id: outcome.moveId, client_notice: outcome.clientNotice }, 200);
}
