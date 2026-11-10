// A client's alerts on their page in the console (src/domain/clients/client-alerts.ts): what every technician reads in
// red before they start. Ops and Care raise them and take them off; each is audited by the client's and the alert's
// IDs, never a word of it. On the ops surface behind Access.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { staffMemberOf } from "../../http/audit.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { alertsOf, raiseAlert, takeOffAlert } from "../../domain/clients/client-alerts.ts";
import { ALERT_MAX_CHARS } from "../../policy/client-record.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { ClientAlertsSchema } from "../schemas/client-record.ts";

const clientId = z.object({ id: z.uuid() });
const alertId = z.object({ id: z.uuid(), alert_id: z.uuid() });
const unknownClient = errorResponse(
  "not_found: no such client, or the client has been erased or is outside the caller's cities",
);
const noStaff = errorResponse("access_required: no Access token, or a service token, which names no member of staff");

const AlertsSchema = z.object({ alerts: ClientAlertsSchema }).strict().openapi("ClientAlerts");

const AlertRaisedSchema = z
  .object({ body: z.string().trim().min(1).max(ALERT_MAX_CHARS) })
  .strict()
  .openapi("ClientAlertRaised");

const readRoute = opsRoute({
  method: "get",
  path: "/api/clients/{id}/alerts",
  summary: "The client's alerts still on, which every technician reads before they start, newest first",
  request: { params: clientId },
  responses: { 200: { description: "The alerts", ...json(AlertsSchema) }, 404: unknownClient },
});

const raiseRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/alerts",
  summary: "Raise an alert on the client under the member of staff, audited",
  request: { params: clientId, body: { required: true, ...json(AlertRaisedSchema) } },
  responses: {
    201: { description: "Raised, and the alerts as they now stand", ...json(AlertsSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    403: noStaff,
    404: unknownClient,
  },
});

const takeOffRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/alerts/{alert_id}/take-off",
  summary: "Take an alert off the client; it is kept, with who took it off and when, audited",
  request: { params: alertId },
  responses: {
    200: { description: "Taken off, or already off, and the alerts as they now stand", ...json(AlertsSchema) },
    403: noStaff,
    404: unknownClient,
  },
});

const alerts = async (c: Context<AppEnv>, personId: string) => ({ alerts: await alertsOf(c.env.DB, personId) });

export function registerOpsClientAlerts(app: App): void {
  app.openapi(readRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    return c.json(await alerts(c, id), 200);
  });

  app.openapi(raiseRoute, async (c) => {
    const { id } = c.req.valid("param");
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    await raiseAlert(c.env.DB, {
      personId: id,
      body: c.req.valid("json").body,
      staff: staff.id,
      now: c.var.deps.now(),
      audit: { surface: "ops", actor: staff, requestId: c.var.requestId },
    });
    return c.json(await alerts(c, id), 201);
  });

  app.openapi(takeOffRoute, async (c) => {
    const { id, alert_id: alert } = c.req.valid("param");
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    await takeOffAlert(c.env.DB, {
      personId: id,
      alertId: alert,
      staff: staff.id,
      now: c.var.deps.now(),
      audit: { surface: "ops", actor: staff, requestId: c.var.requestId },
    });
    return c.json(await alerts(c, id), 200);
  });
}
