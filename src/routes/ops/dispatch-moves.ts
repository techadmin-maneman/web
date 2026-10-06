// A job assigned or moved on the dispatch board, and a client called who had not heard of a move (./dispatch.ts).
//
// Both writes run the clash check, then move the visit and message the client
// with his new window, in one batch. A visit the technician has begun is not
// moved, unless he has only checked in
// and ops choose to clear his check-in. "The client's payment carries over and
// he is never charged for a move ops make", so no amount appears anywhere
// below.

import { createRoute, z } from "@hono/zod-openapi";
import { json } from "../../http/openapi.ts";
import type { Context } from "hono";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { type MoveInput, moveJob, recordToldByPhone } from "../../domain/dispatch/dispatch.ts";
import type { AuditEntry } from "../../domain/ops/audit.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { queueMessage } from "../../http/queue-message.ts";
import { withinRouteReach } from "../../http/staff-access.ts";
import { REASON_MAX_CHARS } from "../../policy/decision-reasons.ts";
import { CLIENT_NOTICES, MOVE_REASONS } from "../../policy/dispatch.ts";

/**
 * The job as the board the move was made from showed it. If either differs from the job now, another ops user
 * has moved it since, and nothing is written.
 */
const EXPECTED = {
  expected_technician_id: z
    .union([z.uuid(), z.null()])
    .openapi({ description: "The technician the board showed the job with; null for a job in the tray." }),
  expected_starts_at: z.iso.datetime().openapi({ description: "The start the board showed the job with." }),
};

const BLACKOUT_REASON = {
  blackout_reason: z.string().trim().min(1).max(REASON_MAX_CHARS).optional().openapi({
    description:
      "Why the visit goes onto a day ops blacked out, as ops typed it: kept with the move, blanked if the client is erased. Without it, a move onto a blacked-out day answers 409 blackout. Ignored for any other day.",
  }),
};

const AssignRequestSchema = z
  .object({
    appointment_id: z.uuid(),
    technician_id: z.uuid(),
    date: z.iso.date().optional(),
    window: z.enum(BOOKING_WINDOWS).optional(),
    reason: z.enum(MOVE_REASONS),
    ...EXPECTED,
    ...BLACKOUT_REASON,
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
    ...BLACKOUT_REASON,
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
      "past_day: the day has gone; window_passed: every start in today's window has passed; clash: the technician already holds a job in that window on that date; on_leave: they are away that day; back_to_back: they took the client's visit just before or just after this one, and a technician never takes two in a row; does_not_fit: the window is free but the visit has no room in it at a start still ahead; blackout: ops blacked the day out, and no blackout_reason came; superseded: the job is not as the board showed it, and fields names what changed (technician, time, or moving: another move of it is being written); in_progress: a technician has begun the visit",
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
      "past_day; window_passed; clash; on_leave; back_to_back; does_not_fit; blackout; superseded, with what changed in fields; in_progress: the technician has begun the visit. One he has only checked in at moves with clear_check_in; one he has started or closed stays where it is",
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

export function registerOpsDispatchMoves(app: App): void {
  app.openapi(assignRoute, (c) => write(c, c.req.valid("json")));

  app.openapi(moveRoute, (c) => write(c, c.req.valid("json")));

  app.openapi(toldRoute, async (c) => {
    const { requestId, deps } = c.var;
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "move", id))) return refuse(c, "not_found");
    const actor = actorOf(c);
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
    if (!recorded) return refuse(c, "not_found");
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
    actor: actorOf(c),
    action: "dispatch.check_in_cleared",
    subject: { kind: "appointment", id: request.appointment_id },
    requestId: c.var.requestId,
  };
}

/** Assigning and moving are the same write; only what ops change differs. */
async function write(c: Context<AppEnv>, request: MoveRequest) {
  const { requestId, deps, log } = c.var;
  const staff = actorOf(c);
  if (!(await withinRouteReach(c, "visit", request.appointment_id))) {
    return refuse(c, "not_found");
  }
  if (!(await mayGoTo(c, request))) return refuse(c, "invalid_request", ["technician_id"]);

  const input: MoveInput = {
    appointmentId: request.appointment_id,
    technicianId: request.technician_id ?? null,
    date: request.date ?? null,
    window: request.window ?? null,
    reason: request.reason,
    actor: staff.id,
    expected: { technicianId: request.expected_technician_id, startsAt: request.expected_starts_at },
    clearCheckIn: checkInClearedBy(c, request),
    blackoutReason: request.blackout_reason ?? null,
  };
  const outcome = await moveJob(
    c.env.DB,
    {
      notify: (messageId) => queueMessage(c, messageId),
    },
    input,
    deps.now(),
  );

  if (outcome.kind === "not_found") return refuse(c, "not_found");
  if (outcome.kind === "superseded") return refuse(c, "superseded", outcome.changed);
  if (outcome.kind === "in_progress") return refuse(c, "in_progress");
  if (outcome.kind === "nothing_to_move") {
    return refuse(c, "invalid_request", ["technician_id", "date", "window"]);
  }
  if (outcome.kind === "no_technician") return refuse(c, "invalid_request", ["technician_id"]);
  if (outcome.kind === "refused") return c.json(errorBody(outcome.reason, requestId), 409);
  log.info("dispatch_moved", { appointment_id: input.appointmentId, move_id: outcome.moveId, reason: input.reason });
  return c.json({ move_id: outcome.moveId, client_notice: outcome.clientNotice }, 200);
}
