// The dispatch board on the ops console, behind Access (Ops Console, board A;
// src/policy/dispatch.ts). The board's reads are here; assigning and moving a job, and a call to a client, are
// ./dispatch-moves.ts.
//   GET  /api/dispatch?from=&city=   the grid, blocks, unassigned tray, leave and utilisation
//   GET  /api/dispatch/version       whether anything the board draws has changed since it was read
//   GET  /api/dispatch/room?appointment_id=&from=   where a job in hand would land this week
//   POST /api/dispatch/assign        put an unassigned job on a technician
//   POST /api/dispatch/move          move a job, with a reason from the design's list
//   POST /api/dispatch/moves/:id/told   ops called a client who had not heard of a move
//
// Each keeps to the caller's cities: the board shows their visits and technicians, and a visit or move elsewhere is
// not found.

import { createRoute, z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { isWithin, techniciansWithin } from "../../domain/clients/places.ts";
import { BOARD_DAYS, boardVersion, dispatchBoard } from "../../domain/dispatch/dispatch-board.ts";
import { dispatchRoomFor } from "../../domain/dispatch/dispatch.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { routeReach, withinRouteReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { BEGUN, UNTOLD_REASONS } from "../../policy/dispatch.ts";
import { PAYMENT_BADGES } from "../../policy/job-visibility.ts";

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
  client_note: z
    .union([z.string(), z.null()])
    .openapi({ description: "The client's note to the technician, as they last wrote it; null for none." }),
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
    cities: z.array(z.string()).openapi({
      description: "The cities the board can be narrowed to: the caller's that we serve, or that have a technician.",
    }),
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

const RoomSchema = z
  .object({
    appointment_id: z.uuid(),
    rooms: z.array(
      z
        .object({
          technician_id: z.uuid(),
          date: z.iso.date(),
          windows: z.array(z.enum(BOOKING_WINDOWS)).min(1),
          starts: z
            .array(z.object({ window: z.enum(BOOKING_WINDOWS), starts_at: z.iso.datetime() }).strict())
            .min(1)
            .openapi({ description: "When the job would start in each of those windows, as the move would place it." }),
        })
        .strict(),
    ),
    blackouts: z.array(z.iso.date()).openapi({
      description:
        "The days of the week ops blacked out, other than the job's own. A move onto one needs a blackout_reason.",
    }),
  })
  .strict()
  .openapi("DispatchRoom", {
    description:
      "Each technician's day in the caller's cities with a window the job would land in, by the check a move runs: today, only at a start still ahead, and never on a day gone. A day not listed has none. Not where the job already is.",
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
    if (!(await withinRouteReach(c, "visit", appointmentId))) return refuse(c, "not_found");
    const room = await dispatchRoomFor(c.env.DB, { appointmentId, from: from ?? indiaDate(now) }, now);
    if (room === null) return refuse(c, "not_found");
    const technicians = await techniciansWithin(c.env.DB, await routeReach(c));
    const reached = room.rooms.filter((each) => isWithin(technicians, each.technician_id));
    return c.json({ appointment_id: appointmentId, rooms: reached, blackouts: room.blackouts }, 200);
  });
}
