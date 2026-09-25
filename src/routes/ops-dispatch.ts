// The dispatch board on the ops console, behind Access (Ops Console, board A;
// src/policy/dispatch.ts):
//   GET  /api/dispatch?from=&city=   the grid, blocks, unassigned tray, leave and utilisation
//   POST /api/dispatch/assign        put an unassigned job on a technician
//   POST /api/dispatch/move          move a job, with a reason from the design's list
//
// Both writes run the clash check before anything reaches FSM, write to FSM,
// then the mirror, then message the client with his new window. "The client's
// payment carries over and he is never charged for a move ops make", so no
// amount appears anywhere below.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { actorOf } from "../domain/audit.ts";
import { BOARD_DAYS, dispatchBoard, moveJob, type MoveInput } from "../domain/dispatch.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import { MOVE_REASONS } from "../policy/dispatch.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

const BlockSchema = z
  .object({
    appointment_id: z.uuid(),
    type: z.union([z.enum(VISIT_TYPES), z.null()]),
    starts_at: z.iso.datetime(),
    window: z.enum(BOOKING_WINDOWS),
    slots: z.number().openapi({ description: "Consultation 1, service 1, replacement 1.5, first fit 2." }),
    status: z.enum(["scheduled", "dispatched", "in_progress", "completed", "cancelled", "terminated", "other"]),
    client: z.union([z.string(), z.null()]).openapi({ description: "First name and last initial." }),
    sector: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("DispatchBlock");

const BoardSchema = z
  .object({
    from: z.iso.date(),
    dates: z.array(z.iso.date()).openapi({ description: `${String(BOARD_DAYS)} days, the board's columns.` }),
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
          appointment_id: z.uuid(),
          type: z.union([z.enum(VISIT_TYPES), z.null()]),
          asked_window: z.union([z.enum(BOOKING_WINDOWS), z.null()]).openapi({
            description:
              "The window the client asked for, from the Request behind the visit; null where nothing recorded one.",
          }),
          offered_window: z.union([z.enum(BOOKING_WINDOWS), z.null()]),
          date: z.union([z.iso.date(), z.null()]),
          sector: z.union([z.string(), z.null()]),
        })
        .strict(),
    ),
    utilisation: z
      .array(z.object({ date: z.iso.date(), percent: z.number().int() }).strict())
      .openapi({ description: "Each column's utilisation, in per cent. Written to events daily as well." }),
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
        description:
          "Leave ops recorded, clipped to this week. Not from FSM: its availability answers free time, not leave.",
      }),
  })
  .strict()
  .openapi("DispatchBoard");

const AssignRequestSchema = z
  .object({
    appointment_id: z.uuid(),
    technician_id: z.uuid(),
    date: z.iso.date().optional(),
    window: z.enum(BOOKING_WINDOWS).optional(),
    reason: z.enum(MOVE_REASONS),
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
  })
  .strict()
  .openapi("DispatchMoveRequest");

const MovedSchema = z
  .object({
    move_id: z.uuid(),
    client_notice: z.enum(["messaged", "unchanged", "no_client"]).openapi({
      description:
        "messaged: the new window was queued to go on WhatsApp; unchanged: only the technician changed, so there was nothing to tell; no_client: the visit has no client on our records.",
    }),
  })
  .strict()
  .openapi("DispatchMoved");

const boardRoute = createRoute({
  method: "get",
  path: "/api/dispatch",
  summary: "The dispatch board: seven days of every active technician, with the unassigned tray",
  request: { query: z.object({ from: z.iso.date().optional(), city: z.string().min(1).max(60).optional() }) },
  responses: {
    200: { description: "The board", ...json(BoardSchema) },
    403: errorResponse("access_required"),
  },
});

const assignRoute = createRoute({
  method: "post",
  path: "/api/dispatch/assign",
  summary: "Put a job on a technician, with a reason. The clash check runs before any write to FSM",
  request: { body: { required: true, ...json(AssignRequestSchema) } },
  responses: {
    200: { description: "Assigned", ...json(MovedSchema) },
    400: errorResponse("invalid_request"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such live job"),
    409: errorResponse(
      "clash: the technician already holds a job in that window on that date; on_leave: they are away that day; does_not_fit: the window is free but the visit has no room in it",
    ),
    502: errorResponse("fsm_refused: FSM would not take it; nothing moved"),
  },
});

const moveRoute = createRoute({
  method: "post",
  path: "/api/dispatch/move",
  summary: "Move a job to another technician, day or window, with a reason. The client is never charged",
  request: { body: { required: true, ...json(MoveRequestSchema) } },
  responses: {
    200: { description: "Moved, and the client told", ...json(MovedSchema) },
    400: errorResponse("invalid_request, including a move to the technician, day and window the job already has"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such live job"),
    409: errorResponse("clash; on_leave; does_not_fit"),
    502: errorResponse("fsm_refused"),
  },
});

export function registerOpsDispatch(app: App): void {
  app.openapi(boardRoute, async (c) => {
    const now = c.var.deps.now();
    const { from, city } = c.req.valid("query");
    return c.json(await dispatchBoard(c.env.DB, { from: from ?? indiaDate(now), city: city ?? null }), 200);
  });

  app.openapi(assignRoute, (c) => write(c, c.req.valid("json")));
  app.openapi(moveRoute, (c) => write(c, c.req.valid("json")));
}

type MoveRequest = z.infer<typeof MoveRequestSchema>;

/** Assigning and moving are the same write; only what ops change differs. */
async function write(c: Context<AppEnv>, request: MoveRequest) {
  const { requestId, deps, config, log } = c.var;
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("ops routes run after requireAccess");

  const input: MoveInput = {
    appointmentId: request.appointment_id,
    technicianId: request.technician_id ?? null,
    date: request.date ?? null,
    window: request.window ?? null,
    reason: request.reason,
    actor: actorOf(identity).id,
  };
  const outcome = await moveJob(
    c.env.DB,
    {
      fsm: deps.fsm,
      labelAsTest: config.environment !== "production",
      notify: (messageId) =>
        c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: requestId } satisfies MessagingMessage),
    },
    input,
    deps.now(),
  );

  if (outcome.kind === "not_found") return c.json(errorBody("not_found", requestId), 404);
  if (outcome.kind === "nothing_to_move") {
    return c.json(errorBody("invalid_request", requestId, ["technician_id", "date", "window"]), 400);
  }
  if (outcome.kind === "refused") {
    // "unknown_reason" here means the job has no technician and none was named:
    // the reason itself is already one of the design's list, by the schema.
    if (outcome.reason === "unknown_reason") {
      return c.json(errorBody("invalid_request", requestId, ["technician_id"]), 400);
    }
    return c.json(errorBody(outcome.reason, requestId), 409);
  }
  if (outcome.kind === "fsm_refused") {
    log.warn("dispatch_move_refused_by_fsm", { appointment_id: input.appointmentId, move_id: outcome.moveId });
    return c.json(errorBody("fsm_refused", requestId), 502);
  }
  log.info("dispatch_moved", { appointment_id: input.appointmentId, move_id: outcome.moveId, reason: input.reason });
  return c.json({ move_id: outcome.moveId, client_notice: outcome.clientNotice }, 200);
}
