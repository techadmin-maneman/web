// Ops changing a client's visit from the console, on the ops surface behind Access:
//
//   POST /api/visits/:id/cancel   { confirm: false }: what a cancel gives back, free to the client and on their own late
//                                 terms; { confirm: true, notice, reason, on_client_terms? }: cancel it
//   POST /api/visits/:id/close    close it as done or partly done, with its times and why, for work whose technician's
//                                 phone was lost
//   POST /api/visits/:id/let-in   let its technician check in wherever the geofence puts him, with why, where the
//                                 address's pin is far from the door
//
// A cancel is free to the client unless ops apply the client's own late terms (src/policy/moving-a-visit.ts). Each is
// audited in the batch that makes it (ADR 0031), with codes and amounts; ops' reason is kept with the change. Both keep
// to the caller's cities: a visit elsewhere is answered as one that does not exist.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { VISIT_TYPES } from "../config/visit-types.ts";
import type { AuditEntry } from "../domain/audit.ts";
import { waiveCheckIn } from "../domain/check-ins.ts";
import { closeByHand } from "../domain/hand-close.ts";
import {
  cancelVisit,
  changeableVisitFor,
  changeTerms,
  opsCancelTerms,
  termsInForce,
  type ChangeTerms,
  type OpsCancel,
} from "../domain/visit-changes.ts";
import { actorOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { json } from "../http/openapi.ts";
import { queueMessage } from "../http/queue-message.ts";
import { withinRouteReach } from "../http/staff-access.ts";
import { REASON_MAX_CHARS } from "../policy/decision-reasons.ts";

const visitParams = z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) });

const NoticeSchema = z.enum(["free", "late"]).openapi({
  description: "free: before the notice the visit was booked under starts; late: inside it.",
});

const CancelOutcomeSchema = z
  .object({
    refund: z.number().int().openapi({ description: "In paise: what goes back to the payment's source." }),
    kept: z.number().int().openapi({ description: "In paise: what is kept as a charge." }),
    credit: z.union([z.enum(["restored", "lost"]), z.null()]).openapi({
      description:
        "For a visit paid with a credit: whether it comes back. Lost on the client's late terms, or where its grant " +
        "has been taken back or has expired; null for a visit paid otherwise.",
    }),
  })
  .strict()
  .openapi("OpsCancelOutcome");

const OpsCancelTermsSchema = z
  .object({
    visit_id: z.uuid(),
    type: z.enum(VISIT_TYPES),
    notice: NoticeSchema,
    notice_hours: z.number().int().openapi({ description: "The notice the visit was booked under, in hours." }),
    paid: z.number().int().openapi({ description: "In paise: what the visit's payment holds." }),
    destination: z.union([z.string(), z.null()]).openapi({ description: "The payment's method: upi, card and so on." }),
    free: CancelOutcomeSchema.openapi({ description: "Free to the client: what ops cancel on unless they choose." }),
    client_terms: CancelOutcomeSchema.openapi({
      description: "On the client's own late terms, which ops may apply with a reason.",
    }),
    cancelled: z.boolean().openapi({ description: "false: the terms only; true: the visit is cancelled." }),
  })
  .strict()
  .openapi("OpsCancelTerms");

const OpsCancelSchema = z
  .object({
    confirm: z.boolean(),
    notice: NoticeSchema.optional().openapi({ description: "With confirm: the notice ops were shown." }),
    on_client_terms: z.boolean().optional().openapi({
      description: "With confirm: apply the client's own late terms. Left out, the cancel is free to the client.",
    }),
    reason: z.string().trim().max(REASON_MAX_CHARS).optional().openapi({
      description: "With confirm, required: why, kept with the cancel and never written to the audit log.",
    }),
  })
  .strict()
  .openapi("OpsCancel");

const cancelRoute = createRoute({
  method: "post",
  path: "/api/visits/{id}/cancel",
  summary: "What cancelling a client's visit gives back, or cancel it: free to the client unless ops choose otherwise",
  request: { params: visitParams, body: { required: true, ...json(OpsCancelSchema) } },
  responses: {
    200: { description: "The terms, or the cancelled visit", ...json(OpsCancelTermsSchema) },
    400: errorResponse("invalid_request: a cancel with no reason"),
    403: errorResponse("access_required"),
    409: errorResponse(
      "not_changeable: the visit has begun, passed or gone, is no client's, or is not in the caller's cities; " +
        "terms_changed: the notice is not the one shown, so show the terms again",
    ),
    503: errorResponse("unavailable: the cancel could not be written; nothing changed"),
  },
});

const HandCloseSchema = z
  .object({
    outcome: z.enum(["done", "partial"]),
    started_at: z.iso.datetime().openapi({ description: "When the work began, on the visit's own day." }),
    ended_at: z.iso.datetime().openapi({ description: "When it ended: after it began, and not later than now." }),
    reason: z.string().trim().max(REASON_MAX_CHARS).openapi({
      description: "Why it is closed by hand, and, for a visit partly done, why: kept with the visit.",
    }),
  })
  .strict()
  .openapi("HandClose");

const closeRoute = createRoute({
  method: "post",
  path: "/api/visits/{id}/close",
  summary: "Close a visit by hand, as done or partly done, for work whose technician's phone was lost",
  request: { params: visitParams, body: { required: true, ...json(HandCloseSchema) } },
  responses: {
    200: {
      description: "Closed",
      ...json(
        z
          .object({
            visit_id: z.uuid(),
            status: z.enum(["completed", "terminated"]),
            duration_minutes: z.union([z.number().int(), z.null()]),
          })
          .strict()
          .openapi("HandClosed"),
      ),
    },
    400: errorResponse("invalid_request: no reason, or times that do not fit the visit's day or end after now"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such visit in the caller's cities"),
    409: errorResponse("already_closed: the visit is closed or cancelled, or the technician's phone closed it"),
    425: errorResponse("too_early_to_close: the visit's time has not come"),
  },
});

const letInRoute = createRoute({
  method: "post",
  path: "/api/visits/{id}/let-in",
  summary: "Let the visit's technician check in wherever his phone puts him, with why: a pin far from the door",
  request: {
    params: visitParams,
    body: {
      required: true,
      ...json(
        z
          .object({
            reason: z.string().trim().max(REASON_MAX_CHARS).openapi({
              description: "Why, as ops write it: kept with the visit, and shown with the no-show's evidence.",
            }),
          })
          .strict()
          .openapi("LetIn"),
      ),
    },
  },
  responses: {
    200: { description: "His next check-in lands", ...json(z.object({ let_in: z.literal(true) }).strict()) },
    400: errorResponse("invalid_request: no reason"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such visit in the caller's cities"),
    409: errorResponse("not_changeable: he has checked in already, or the visit is closed or cancelled"),
  },
});

/** What a cancel gives back, as the console shows it before ops confirm. */
const cancelOutcomeOf = (terms: ChangeTerms) => ({
  refund: terms.cancel.refund,
  kept: terms.cancel.kept,
  credit: terms.credit?.outcome ?? null,
});

/** The terms the console shows: what the visit's payment holds, and what each choice of terms gives back. */
const cancelTermsOf = (terms: ChangeTerms) => ({
  visit_id: terms.visit.id,
  type: terms.visit.type,
  notice: terms.notice,
  notice_hours: terms.noticeHours,
  paid: terms.payment?.paid ?? 0,
  destination: terms.payment?.method ?? null,
  free: cancelOutcomeOf(opsCancelTerms(terms, false)),
  client_terms: cancelOutcomeOf(opsCancelTerms(terms, true)),
});

/** The audit entry for a change ops make to one visit; the detail holds codes and amounts, never their reason. */
function visitAudit(
  c: Context<AppEnv>,
  action: "visit.cancel" | "visit.close" | "visit.checkin_waive",
  visitId: string,
  detail: AuditEntry["detail"],
) {
  return {
    surface: "ops",
    actor: actorOf(c),
    action,
    subject: { kind: "appointment", id: visitId },
    requestId: c.var.requestId,
    detail,
  } as const;
}

export function registerOpsVisitChanges(app: App): void {
  app.openapi(cancelRoute, (c) => cancelForClient(c, c.req.valid("param").id, c.req.valid("json")));
  app.openapi(closeRoute, (c) => closeForTechnician(c, c.req.valid("param").id, c.req.valid("json")));
  app.openapi(letInRoute, async (c) => {
    const { requestId, deps, log } = c.var;
    const visitId = c.req.valid("param").id;
    const { reason } = c.req.valid("json");
    if (reason === "") return c.json(errorBody("invalid_request", requestId, ["reason"]), 400);
    if (!(await withinRouteReach(c, "visit", visitId))) return c.json(errorBody("not_found", requestId), 404);
    const waived = await waiveCheckIn(c.env.DB, {
      appointmentId: visitId,
      by: actorOf(c).id,
      reason,
      audit: visitAudit(c, "visit.checkin_waive", visitId, undefined),
      now: deps.now(),
    });
    if (!waived) return c.json(errorBody("not_changeable", requestId), 409);
    log.info("visit_checkin_waived", { appointment_id: visitId });
    return c.json({ let_in: true as const }, 200);
  });
}

type CancelAsked = z.infer<typeof OpsCancelSchema>;

/** The cancel ops chose: on which terms, by whom, why, and the audit entry that records it, amounts and no words. */
function opsCancelOf(c: Context<AppEnv>, terms: ChangeTerms, onClientTerms: boolean, reason: string) {
  const applied = opsCancelTerms(terms, onClientTerms);
  const choice = onClientTerms ? "client" : "free";
  const detail = { terms: choice, refund: applied.cancel.refund, kept: applied.cancel.kept };
  const ops: OpsCancel = {
    staff: actorOf(c).id,
    reason,
    terms: choice,
    audit: visitAudit(c, "visit.cancel", terms.visit.id, detail),
  };
  return { applied, ops };
}

/**
 * A client's visit cancelled for them: the terms each choice gives, or, confirmed with a reason, the cancel itself, on
 * the terms ops chose.
 */
async function cancelForClient(c: Context<AppEnv>, visitId: string, asked: CancelAsked) {
  const db = c.env.DB;
  const { deps, requestId, log } = c.var;
  const now = deps.now();
  if (!(await withinRouteReach(c, "visit", visitId))) return c.json(errorBody("not_changeable", requestId), 409);
  const visit = await changeableVisitFor(db, visitId, now);
  if (visit === null) return c.json(errorBody("not_changeable", requestId), 409);
  const terms = await changeTerms(db, visit, now, termsInForce(await opsInputs(c), visit.type));
  const shown = cancelTermsOf(terms);
  if (!asked.confirm) return c.json({ ...shown, cancelled: false }, 200);
  const reason = asked.reason ?? "";
  if (reason === "") return c.json(errorBody("invalid_request", requestId, ["reason"]), 400);
  if (asked.notice !== terms.notice) return c.json(errorBody("terms_changed", requestId), 409);

  const { applied, ops } = opsCancelOf(c, terms, asked.on_client_terms === true, reason);
  const notify = (messageId: string) => queueMessage(c, messageId);
  let outcome;
  try {
    outcome = await cancelVisit(db, { ...deps, notify }, applied, now, { log, ops });
  } catch (error) {
    log.error("cancel_failed", { appointment_id: visit.id, error });
    return c.json(errorBody("unavailable", requestId), 503);
  }
  if (outcome.kind === "not_changeable") return c.json(errorBody("not_changeable", requestId), 409);
  log.info("visit_cancelled_by_ops", {
    appointment_id: visit.id,
    terms: ops.terms,
    refund: outcome.refund,
    refund_pending: outcome.refundPending,
  });
  return c.json({ ...shown, cancelled: true }, 200);
}

/** A visit closed by hand for its technician, whose phone was lost before it sent anything. */
async function closeForTechnician(c: Context<AppEnv>, visitId: string, asked: z.infer<typeof HandCloseSchema>) {
  const { requestId, deps, log } = c.var;
  if (asked.reason === "") return c.json(errorBody("invalid_request", requestId, ["reason"]), 400);
  if (!(await withinRouteReach(c, "visit", visitId))) return c.json(errorBody("not_found", requestId), 404);

  const close = {
    appointmentId: visitId,
    outcome: asked.outcome,
    startedAt: asked.started_at,
    endedAt: asked.ended_at,
    byHand: { by: actorOf(c).id, reason: asked.reason },
    audit: visitAudit(c, "visit.close", visitId, { outcome: asked.outcome }),
  };
  const linkDeps = { ...deps, log, messagingSettings: c.var.config.settings.messaging };
  const closed = await closeByHand(c.env.DB, linkDeps, close, deps.now());
  if (closed.kind === "closed") {
    log.info("visit_closed_by_hand", { appointment_id: visitId, outcome: asked.outcome });
    return c.json({ visit_id: visitId, status: closed.status, duration_minutes: closed.durationMinutes }, 200);
  }
  if (closed.code === "not_found") return c.json(errorBody("not_found", requestId), 404);
  if (closed.code === "bad_times") {
    return c.json(errorBody("invalid_request", requestId, ["started_at", "ended_at"]), 400);
  }
  if (closed.code === "too_early_to_close") return c.json(errorBody(closed.code, requestId), 425);
  return c.json(errorBody(closed.code, requestId), 409);
}
