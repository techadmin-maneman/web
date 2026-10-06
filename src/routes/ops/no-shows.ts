// The no-shows ops rule on, with their evidence (./field.ts).
//
// "A no-show is charged under the 24-hour policy. The charge is applied by ops
// from the evidence, never automatically": nothing here charges anybody until
// ops rule. A charge costs what the booking was sold to cost a no-show
// (no_show_charge, ADR 0088): a first fit or a replacement keeps its late fee and
// refunds the rest, a paid service visit is kept, a credit is lost, as a late
// cancel of the same visit would, and the ruling records what it kept
// (src/policy/no-show.ts, docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
// A waiver gives back what ops set it to (no_show_waiver): the payment refunded
// and the credit returned, and the
// ruling keeps what it gave. Either way the client is told on WhatsApp, with
// their consent to messages about visits.

import { createRoute, z } from "@hono/zod-openapi";
import { json } from "../../http/openapi.ts";
import { afterRuling } from "../../domain/no-shows/after-a-ruling.ts";
import { decideNoShow, listNoShowCases, MESSAGE_STATES } from "../../domain/no-shows/no-shows.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { queueMessage } from "../../http/queue-message.ts";
import { permitsOn, routeReach, withinRouteReach } from "../../http/staff-access.ts";
import { WAIVING_A_NO_SHOW } from "../../policy/console-routes.ts";
import { needsReason, REASON_MAX_CHARS } from "../../policy/decision-reasons.ts";
import { NO_SHOW_DECISIONS } from "../../policy/no-show.ts";
import { dueAt } from "../../policy/tasks.ts";

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
      description:
        "Fact one: when the technician arrived, by his phone, held within bounds. The wait ran from here, or from " +
        "the booked start for an arrival before it.",
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
    let_in: z
      .union([z.object({ by: z.string(), reason: z.union([z.string(), z.null()]) }).strict(), z.null()])
      .openapi({
        description:
          "Ops let him check in past the geofence for this visit: who, and why. Null when his check-in passed on its own.",
      }),
    radius_m: z.number().int().openapi({
      description:
        "The check-in radius in force when he checked in, which the check-in keeps: the distance is read against it, not against the radius ops have set since.",
    }),
    message_state: z.enum(MESSAGE_STATES).openapi({
      description:
        "Fact three: what became of the day-before or arrival WhatsApp. none: nothing was queued; no_consent: not sent, the client never agreed to WhatsApp about visits; not_sent: skipped or failed; sent: no receipt came back; delivered.",
    }),
    message_delivered_at: z
      .union([z.iso.datetime(), z.null()])
      .openapi({ description: "When WhatsApp reported it delivered; null if it never did." }),
    wait_ends_at: z.iso.datetime(),
    closed_early: z.boolean().openapi({
      description:
        "The wait ran from a check-in before the booked start, so the case closed before the client's own wait had " +
        "run: waive it, or give the reason to charge.",
    }),
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
  .object({
    cases: z.array(NoShowCaseSchema),
    waiver: z
      .object({ payment: z.enum(["refunded", "kept"]), credit: z.enum(["returned", "spent"]) })
      .strict()
      .openapi({ description: "What waiving a case gives back now, as ops set it in Settings (no_show_waiver)." }),
  })
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

const noShowsRoute = createRoute({
  method: "get",
  path: "/api/no-shows",
  summary: "No-show cases in the caller's cities: undecided first, each with its three facts",
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
    403: errorResponse("access_required, or not_permitted: waiving asks Finance MANAGE in the case's city"),
    404: errorResponse("not_found: no such case in the caller's cities, or it was ruled on already"),
  },
});

export function registerOpsNoShows(app: App): void {
  app.openapi(noShowsRoute, async (c) => {
    const { decision } = c.req.valid("query");
    const reached = await routeReach(c);
    const [cases, inputs] = await Promise.all([listNoShowCases(c.env.DB, decision, 200, reached), opsInputs(c)]);
    const due = (openedAt: string) => dueAt(new Date(openedAt), "no_show_decision", inputs.taskSlaHours).toISOString();
    return c.json(
      { cases: cases.map((each) => ({ ...each, due: due(each.opened_at) })), waiver: inputs.noShowWaiver },
      200,
    );
  });

  app.openapi(decisionRoute, async (c) => {
    const staff = actorOf(c);
    const { id } = c.req.valid("param");
    const { decision, reason } = c.req.valid("json");
    if (needsReason("no_show", decision) && (reason ?? "") === "") {
      return refuse(c, "invalid_request", ["reason"]);
    }
    if (!(await withinRouteReach(c, "no_show", id))) return refuse(c, "not_found");
    if (decision === "waived" && !(await permitsOn(c, WAIVING_A_NO_SHOW, "no_show", id))) {
      return refuse(c, "not_permitted");
    }
    const now = c.var.deps.now();
    const inputs = await opsInputs(c);

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
      waiver: inputs.noShowWaiver,
      terms: inputs,
      disputeWindowDays: inputs.disputeWindowDays,
    });
    if (ruled === null) return refuse(c, "not_found");
    const notify = (messageId: string) => queueMessage(c, messageId);
    await afterRuling(c.env.DB, { ...c.var.deps, notify }, ruled);
    return c.json({ decided: true }, 200);
  });
}
