// What ops do about field work, behind Access (src/policy/no-show.ts,
// technician-login.ts):
//   GET  /api/no-shows                                   the cases, with their evidence
//   POST /api/no-shows/:id/decision                      charge or waive, from the evidence
//   GET  /api/clients/:id/pieces                         the pieces tab
//   GET  /api/technicians                                who works, the phones they work from, and their leave
//   POST /api/technicians/:id/devices/:device/revoke     revoke a phone; it drops its cached jobs
//   POST /api/technicians/:id/leave                      record leave; the board and booking both refuse those days
//   POST /api/technicians/:id/leave/:leave/cancel        take it back
//
// "A no-show is charged under the 24-hour policy. The charge is applied by ops
// from the evidence, never automatically": nothing here charges anybody. The
// decision is recorded, and a charge keeps what the visit took, as a client's
// own late cancel does (src/policy/moving-a-visit.ts). What a waiver gives back
// is the owner's to rule (src/policy/no-show.ts, WAIVER_GIVES_BACK). Either way
// the client is told on WhatsApp, with their consent to messages about visits.

import { createRoute, z } from "@hono/zod-openapi";
import { staffOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { cancelLeave, LEAVE_MAX_DAYS, leaveFrom, recordLeave } from "../domain/leave.ts";
import { decideNoShow, listNoShowCases, MESSAGE_STATES, refundWaivedVisit } from "../domain/no-shows.ts";
import { piecesOf, syncPieces } from "../domain/pieces.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { devicesByTechnician, revokeDevice } from "../domain/technicians.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import { needsReason, REASON_MAX_CHARS } from "../policy/decision-reasons.ts";
import { NO_SHOW_DECISIONS, WAIVER_GIVES_BACK } from "../policy/no-show.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { dueAt } from "../policy/tasks.ts";
import { PieceSchema } from "./tech-pieces.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

const NoShowCaseSchema = z
  .object({
    id: z.uuid(),
    appointment_id: z.uuid(),
    person: z.union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()]).openapi({
      description: "Whose visit it was, so ops can open their page and call them; null once they have been erased.",
    }),
    visit_date: z.union([z.string(), z.null()]),
    technician: z.union([z.string(), z.null()]),
    checked_in_at: z.iso.datetime().openapi({
      description: "Fact one: when the technician arrived, by his phone, held within bounds. The wait ran from here.",
    }),
    phone_checked_in_at: z.union([z.iso.datetime(), z.null()]).openapi({
      description: "What the phone itself said, before the bounds; null when it said nothing.",
    }),
    received_at: z.iso.datetime().openapi({
      description: "When the check-in reached us: long after the phone's time means no signal, or a clock set back.",
    }),
    window_start: z.union([z.iso.datetime(), z.null()]).openapi({ description: "The visit's booked window." }),
    window_end: z.union([z.iso.datetime(), z.null()]),
    minutes_late: z.union([z.number().int(), z.null()]).openapi({
      description: "Minutes from the booked start to the check-in; negative when he was early.",
    }),
    distance_m: z.union([z.number().int(), z.null()]).openapi({
      description:
        "Fact two: how far from the address he was; null where the address had no coordinates and nothing was measured.",
    }),
    message_state: z.enum(MESSAGE_STATES).openapi({
      description:
        "Fact three: what became of the day-before or arrival WhatsApp. none: nothing was queued; no_consent: not sent, the client never agreed to WhatsApp about visits; not_sent: skipped or failed; sent: no receipt came back; delivered.",
    }),
    message_delivered_at: z
      .union([z.iso.datetime(), z.null()])
      .openapi({ description: "When WhatsApp reported it delivered; null if it never did." }),
    wait_ends_at: z.iso.datetime(),
    closed_at: z.union([z.iso.datetime(), z.null()]),
    opened_at: z.iso.datetime().openapi({ description: "When the case opened, and started waiting for ops." }),
    due: z.iso.datetime().openapi({
      description: "When ops should have ruled: the Tasks board's allowance for a no-show, from opened_at.",
    }),
    decision: z.enum(NO_SHOW_DECISIONS),
    decided_at: z.union([z.iso.datetime(), z.null()]),
  })
  .strict()
  .openapi("NoShowCase", { description: "The three facts ops rule on, and nothing else." });

const NoShowsSchema = z
  .object({ cases: z.array(NoShowCaseSchema) })
  .strict()
  .openapi("NoShowCases");

const DecisionRequestSchema = z
  .object({
    decision: z.enum(["charged", "waived"]),
    reason: z.string().trim().max(REASON_MAX_CHARS).nullable().openapi({
      description: "Required either way, and kept with the ruling (src/policy/decision-reasons.ts).",
    }),
  })
  .strict()
  .openapi("NoShowDecisionRequest");

const ClientPiecesSchema = z
  .object({ pieces: z.array(PieceSchema) })
  .strict()
  .openapi("ClientPieces");

const LeaveSchema = z
  .object({
    id: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date().openapi({ description: "Inclusive: a single day's leave has the same date twice." }),
    note: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("TechnicianLeave");

const TechniciansSchema = z
  .object({
    technicians: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          initials: z.string(),
          zone: z.union([z.string(), z.null()]),
          devices: z.array(
            z
              .object({
                device_id: z.string(),
                label: z.union([z.string(), z.null()]),
                last_seen_at: z.iso.datetime(),
                revoked_at: z.union([z.iso.datetime(), z.null()]),
              })
              .strict(),
          ),
          leave: z
            .array(LeaveSchema)
            .openapi({ description: "Leave that has not ended yet, soonest first (ADR 0062)." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("Technicians");

const LeaveRequestSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    note: z.string().min(1).max(200).optional().openapi({ description: "Why, in ops' words. Never a medical detail." }),
  })
  .strict()
  .openapi("TechnicianLeaveRequest");

const LeaveRecordedSchema = z
  .object({
    id: z.uuid(),
    jobs: z
      .array(
        z
          .object({
            appointment_id: z.uuid(),
            starts_at: z.iso.datetime(),
            type: z.union([z.enum(VISIT_TYPES), z.null()]),
            client: z.union([z.string(), z.null()]),
          })
          .strict(),
      )
      .openapi({
        description:
          "The jobs already booked on those days, which the leave moves nowhere: ops move them on the dispatch " +
          "board, and each waits on the Tasks board until they do (OPS-07).",
      }),
  })
  .strict()
  .openapi("TechnicianLeaveRecorded");

const noShowsRoute = createRoute({
  method: "get",
  path: "/api/no-shows",
  summary: "No-show cases: undecided first, each with its three facts",
  request: { query: z.object({ decision: z.enum([...NO_SHOW_DECISIONS, "all"]).default("undecided") }) },
  responses: { 200: { description: "The cases", ...json(NoShowsSchema) }, 403: errorResponse("access_required") },
});

const decisionRoute = createRoute({
  method: "post",
  path: "/api/no-shows/{id}/decision",
  summary: "Charge or waive a no-show, from the evidence",
  request: { params: z.object({ id: z.uuid() }), body: { required: true, ...json(DecisionRequestSchema) } },
  responses: {
    200: { description: "Recorded", ...json(z.object({ decided: z.boolean() }).strict()) },
    400: errorResponse("invalid_request: a ruling needs a reason"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such case, or it was ruled on already"),
  },
});

const piecesRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/pieces",
  summary: "A client's pieces: code, base, fitted date, supplier lot, replacement due and any failure",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The pieces, newest fit first", ...json(ClientPiecesSchema) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such client"),
  },
});

const techniciansRoute = createRoute({
  method: "get",
  path: "/api/technicians",
  summary: "Active technicians, the phones they have logged in on, and the leave they are down for",
  responses: {
    200: { description: "The technicians", ...json(TechniciansSchema) },
    403: errorResponse("access_required"),
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
    404: errorResponse("not_found: no such active technician"),
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
    404: errorResponse("not_found: no such leave of that technician's"),
  },
});

const revokeRoute = createRoute({
  method: "post",
  path: "/api/technicians/{id}/devices/{device}/revoke",
  summary: "Revoke a phone. Its session ends, and it drops its cached jobs on its next contact",
  request: { params: z.object({ id: z.uuid(), device: z.string().min(1).max(64) }) },
  responses: {
    200: { description: "Revoked", ...json(z.object({ revoked_at: z.iso.datetime() }).strict()) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such phone of that technician's"),
  },
});

export function registerOpsField(app: App): void {
  app.openapi(noShowsRoute, async (c) => {
    const { decision } = c.req.valid("query");
    const [cases, inputs] = await Promise.all([listNoShowCases(c.env.DB, decision, 200), opsInputs(c)]);
    const due = (openedAt: string) => dueAt(new Date(openedAt), "no_show_decision", inputs.taskSlaHours).toISOString();
    return c.json({ cases: cases.map((each) => ({ ...each, due: due(each.opened_at) })) }, 200);
  });

  app.openapi(decisionRoute, async (c) => {
    const staff = staffOf(c);
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    if (needsReason("no_show", decision) && (reason ?? "") === "") {
      return c.json(errorBody("invalid_request", c.var.requestId, ["reason"]), 400);
    }
    const now = c.var.deps.now();

    const ruled = await decideNoShow(c.env.DB, {
      caseId: id,
      decision,
      reason,
      actor: staff.id,
      audit: {
        surface: "ops",
        actor: staff,
        action: "no_show.decide",
        subject: { kind: "no_show_case", id },
        requestId: c.var.requestId,
        detail: { decision },
      },
      now,
      waiverGivesBack: WAIVER_GIVES_BACK,
    });
    if (ruled === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    if (ruled.refund !== null) await refundWaivedVisit(c.env.DB, c.var.deps, ruled.refund);
    if (ruled.messageId !== null) {
      await c.env.MESSAGE_QUEUE.send({
        message_id: ruled.messageId,
        request_id: c.var.requestId,
      } satisfies MessagingMessage);
    }
    return c.json({ decided: true }, 200);
  });

  app.openapi(piecesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const client = await c.env.DB.prepare("SELECT id, fsm_contact_id FROM people WHERE id = ?1 AND erased_at IS NULL")
      .bind(id)
      .first<{ id: string; fsm_contact_id: string | null }>();
    if (client === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    // FSM is the record, so the copy is read afresh before it is shown.
    if (client.fsm_contact_id !== null && c.var.config.providers.FSM_PROVIDER !== "none") {
      await syncPieces(
        c.env.DB,
        c.var.deps.fsm,
        { personId: id, fsmContactId: client.fsm_contact_id },
        c.var.deps.now(),
        (await opsInputs(c)).pieceCycleDays,
      ).catch((error: unknown) => {
        c.var.log.warn("pieces_sync_failed", { person_id: id, error });
        return 0;
      });
    }
    const pieces = await piecesOf(c.env.DB, id);
    return c.json(
      {
        pieces: pieces.map((piece) => ({
          piece_code: piece.piece_code,
          base: piece.base,
          supplier_lot: piece.supplier_lot,
          fitted_at: piece.fitted_at === null ? null : piece.fitted_at.slice(0, 10),
          replacement_due_at: piece.replacement_due_at === null ? null : piece.replacement_due_at.slice(0, 10),
          failed_at: piece.failed_at,
          failure_reason: piece.failure_reason,
        })),
      },
      200,
    );
  });

  app.openapi(techniciansRoute, async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name, initials, zone FROM technicians WHERE active = 1 ORDER BY name",
    ).all<{ id: string; name: string; initials: string; zone: string | null }>();
    // The phones and the leave are one read each for the whole roster, not one per technician.
    const [devices, leave] = await Promise.all([
      devicesByTechnician(c.env.DB),
      leaveFrom(c.env.DB, indiaDate(c.var.deps.now())),
    ]);
    const technicians = results.map((technician) => ({
      ...technician,
      devices: devices.get(technician.id) ?? [],
      leave: leave
        .filter((period) => period.technician_id === technician.id)
        .map(({ id, from, to, note }) => ({ id, from, to, note })),
    }));
    return c.json({ technicians }, 200);
  });

  app.openapi(leaveRoute, async (c) => {
    const staff = staffOf(c);
    const { id } = c.req.valid("param");
    const { from, to, note } = c.req.valid("json");
    const now = c.var.deps.now();

    const outcome = await recordLeave(
      c.env.DB,
      { technicianId: id, from, to, note: note ?? null, actor: staff.id },
      indiaDate(now),
      now,
      {
        surface: "ops",
        actor: staff,
        action: "technician.leave",
        subject: { kind: "technician", id },
        requestId: c.var.requestId,
        detail: { from, to },
      },
    );
    if (outcome.kind === "no_such_technician") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (outcome.kind === "bad_dates") return c.json(errorBody("invalid_request", c.var.requestId, ["to"]), 400);
    return c.json({ id: outcome.id, jobs: outcome.jobs }, 200);
  });

  app.openapi(cancelLeaveRoute, async (c) => {
    const staff = staffOf(c);
    const { id, leave } = c.req.valid("param");
    const now = c.var.deps.now();

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
    if (!cancelled) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json({ cancelled: true }, 200);
  });

  app.openapi(revokeRoute, async (c) => {
    const staff = staffOf(c);
    const { id, device } = c.req.valid("param");
    const now = c.var.deps.now();

    const revoked = await revokeDevice(c.env.DB, {
      technicianId: id,
      deviceId: device,
      actor: staff.id,
      audit: {
        surface: "ops",
        actor: staff,
        action: "technician_device.revoke",
        subject: { kind: "technician", id },
        requestId: c.var.requestId,
        detail: { device_id: device },
      },
      now,
    });
    const revokedAt = revoked?.revokedAt ?? null;
    if (revokedAt === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    c.var.log.info("technician_device_revoked", { technician_id: id, device_id: device });
    return c.json({ revoked_at: revokedAt }, 200);
  });
}
