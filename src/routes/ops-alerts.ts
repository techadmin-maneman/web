// The Tasks board's "Needs a hand", behind Access (src/domain/needs-a-hand.ts):
//   GET  /api/alerts                    the open alerts ops have been told of, of the caller's departments
//   POST /api/alerts/:id/resolve        mark one done
//   POST /api/alerts/:id/send-again     send again the message, lead or CRM erasure it gave up on
// Each department sees and acts on its own kinds of alert (src/policy/alerts.ts); every action is audited under the
// member of staff who took it.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { callerAccess, permits } from "../http/staff-access.ts";
import { markDone, openAlert, openAlerts, sendAgain, type OpenAlert } from "../domain/needs-a-hand.ts";
import type { AuditAction, AuditEntry } from "../domain/audit.ts";
import { markDoneLevel, maySendAgain } from "../policy/alerts.ts";
import { alertNeed, meetsNeed } from "../policy/console-routes.ts";

/** The alerts the list shows, the longest open; its count is all of them. */
export const ALERTS_SHOWN = 50;

const AlertSchema = z
  .object({
    id: z.uuid(),
    kind: z.string().openapi({ description: 'What went wrong: the alert\'s key up to its first colon, "crm_lead".' }),
    message: z.string().openapi({ description: "What happened and what to do, with IDs only, as the chat was told." }),
    link: z
      .union([z.string(), z.null()])
      .openapi({ description: 'Where in the console to act on it, as a path: "/clients/<personId>".' }),
    count: z.number().int().openapi({ description: "How many times it has happened." }),
    told_at: z.iso.datetime().openapi({ description: "When ops were first told." }),
    last_seen_at: z.iso.datetime(),
    send_again: z.boolean().openapi({
      description: "Its work can be sent again from here: a message, a lead to the CRM, or an erasure there.",
    }),
  })
  .strict()
  .openapi("OpenAlert");

const AlertsSchema = z
  .object({
    count: z.number().int().openapi({ description: "How many are open, all of them." }),
    alerts: z.array(AlertSchema).openapi({ description: `The longest open first, at most ${String(ALERTS_SHOWN)}.` }),
  })
  .strict()
  .openapi("OpenAlerts");

const listRoute = createRoute({
  method: "get",
  path: "/api/alerts",
  summary: "The open alerts ops have been told of, the longest open first",
  responses: {
    200: { description: "Of the caller's own departments once the Staff list is enforced", ...json(AlertsSchema) },
    403: errorResponse("access_required, or not_permitted: no View in any department"),
  },
});

const AlertParams = z.object({ id: z.uuid() });

const resolveRoute = createRoute({
  method: "post",
  path: "/api/alerts/{id}/resolve",
  summary: "Mark an alert done: what it was about is put right",
  request: { params: AlertParams },
  responses: {
    204: { description: "Closed, under the member of staff who closed it" },
    403: errorResponse(
      "not_permitted: it asks Act in the department the alert's kind belongs to, and Manage for a CRM erasure",
    ),
    404: errorResponse("not_found: no such open alert; it may be closed already"),
  },
});

const sendAgainRoute = createRoute({
  method: "post",
  path: "/api/alerts/{id}/send-again",
  summary: "Send again the message, lead or CRM erasure an alert gave up on, and close the alert",
  request: { params: AlertParams },
  responses: {
    204: { description: "Sent again, and the alert closed: a new alert follows if it fails again" },
    400: errorResponse("invalid_request: this kind of alert has nothing to send again"),
    403: errorResponse("not_permitted: it asks Act in the department the alert's kind belongs to"),
    404: errorResponse("not_found: no such open alert; it may be closed already"),
  },
});

/** Which kinds of alert the caller sees: their own departments', or every kind while the list is not enforced. */
async function seenBy(c: Context<AppEnv>): Promise<(kind: string) => boolean> {
  const access = await callerAccess(c);
  if (!access.enforced) return () => true;
  return (kind) => meetsNeed(access.caller, alertNeed(kind, "view"), access.zoneOf);
}

const shown = (alert: OpenAlert) => ({
  id: alert.id,
  kind: alert.kind,
  message: alert.message,
  link: alert.link,
  count: alert.count,
  told_at: alert.toldAt,
  last_seen_at: alert.lastSeenAt,
  send_again: maySendAgain(alert.kind),
});

function auditOf(c: Context<AppEnv>, alert: OpenAlert, action: AuditAction): AuditEntry {
  return {
    surface: "ops",
    actor: staffOf(c),
    action,
    subject: { kind: "alert", id: alert.id },
    requestId: c.var.requestId,
    detail: { kind: alert.kind },
  };
}

export function registerOpsAlerts(app: App): void {
  app.openapi(listRoute, async (c) => {
    const [alerts, sees] = await Promise.all([openAlerts(c.env.DB), seenBy(c)]);
    const theirs = alerts.filter((alert) => sees(alert.kind));
    return c.json({ count: theirs.length, alerts: theirs.slice(0, ALERTS_SHOWN).map(shown) }, 200);
  });

  app.openapi(resolveRoute, async (c) => {
    const { requestId } = c.var;
    const alert = await openAlert(c.env.DB, c.req.valid("param").id);
    if (alert === null) return c.json(errorBody("not_found", requestId), 404);
    const need = alertNeed(alert.kind, markDoneLevel(alert.kind));
    if (!(await permits(c, need))) return c.json(errorBody("not_permitted", requestId), 403);

    await markDone(c.env.DB, alert, { now: c.var.deps.now(), audit: auditOf(c, alert, "alert.resolve") });
    return c.body(null, 204);
  });

  app.openapi(sendAgainRoute, async (c) => {
    const { requestId, log } = c.var;
    const alert = await openAlert(c.env.DB, c.req.valid("param").id);
    if (alert === null) return c.json(errorBody("not_found", requestId), 404);
    if (!(await permits(c, alertNeed(alert.kind, "act")))) return c.json(errorBody("not_permitted", requestId), 403);
    const { kind } = alert;
    if (!maySendAgain(kind)) return c.json(errorBody("invalid_request", requestId), 400);

    await sendAgain(c.env, alert, kind, {
      now: c.var.deps.now(),
      audit: auditOf(c, alert, "alert.send_again"),
      requestId,
      log,
    });
    return c.body(null, 204);
  });
}
