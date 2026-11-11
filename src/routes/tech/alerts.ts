// A technician's alerts (src/domain/field/tech-alerts.ts): the inbox and the kinds on, read; the inbox marked read once
// opened; kinds turned on or off; and the phone's push subscription, kept until the phone is signed out or revoked.

import { z } from "@hono/zod-openapi";
import { alertSettingsOf, setAlertSetting } from "../../domain/field/alert-settings.ts";
import { inboxOf, markAlertsRead, subscribeForPushes } from "../../domain/field/tech-alerts.ts";
import type { AlertSetting } from "../../policy/tech-alerts.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { isPushEndpoint } from "../../providers/web-push.ts";
import { AlertSettingsChangeSchema, AlertSettingsSchema, AlertsSchema } from "../schemas/tech-alerts.ts";

const SIGNED_IN = "session_required; device_revoked; technician_inactive: ops switched the technician off";

const alertsRoute = techRoute({
  method: "get",
  path: "/api/tech/alerts",
  summary: "The technician's alerts of the last seven days, newest first, and the kinds they have on",
  responses: {
    200: { description: "The inbox", ...json(AlertsSchema) },
    401: errorResponse(SIGNED_IN),
  },
});

const readRoute = techRoute({
  method: "post",
  path: "/api/tech/alerts/read",
  summary: "Every alert the technician has, read: they opened the inbox",
  responses: {
    204: { description: "Read" },
    401: errorResponse(SIGNED_IN),
  },
});

const settingsRoute = techRoute({
  method: "patch",
  path: "/api/tech/alerts/settings",
  summary: "Kinds of alert turned on or off",
  request: { body: { required: true, ...json(AlertSettingsChangeSchema) } },
  responses: {
    200: { description: "The kinds on, as they now are", ...json(AlertSettingsSchema) },
    400: errorResponse("invalid_request"),
    401: errorResponse(SIGNED_IN),
  },
});

const PushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      .refine(isPushEndpoint, "a browser's push service")
      .openapi({ description: "The push service's address for this phone, as the browser gave it." }),
  })
  .strict()
  .openapi("TechnicianPushSubscription");

const PushSubscribedSchema = z
  .object({ endpoint: z.string(), subscribed_at: z.iso.datetime() })
  .strict()
  .openapi("TechnicianPushSubscribed");

const subscribeRoute = techRoute({
  method: "post",
  path: "/api/tech/push-subscriptions",
  summary: "This phone takes the technician's pushes, until it is signed out or revoked",
  request: { body: { required: true, ...json(PushSubscriptionSchema) } },
  responses: {
    201: { description: "Kept", ...json(PushSubscribedSchema) },
    400: errorResponse("invalid_request: not a browser's push service"),
    401: errorResponse(SIGNED_IN),
  },
});

export function registerTechAlerts(app: App): void {
  app.openapi(alertsRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const { addressUnlockHour, leaveNoticeMin, dayAheadHour } = await opsInputs(c);
    const [alerts, settings] = await Promise.all([
      inboxOf(c.env.DB, technicianId, { now, unlockHour: addressUnlockHour }),
      alertSettingsOf(c.env.DB, technicianId),
    ]);
    const notice = { leave_notice_min: leaveNoticeMin, day_ahead_hour: dayAheadHour };
    return c.json({ alerts, settings, ...notice, push_key: c.var.config.settings.push?.publicKey ?? null }, 200);
  });

  app.openapi(readRoute, async (c) => {
    await markAlertsRead(c.env.DB, technicianOf(c).technicianId, c.var.deps.now());
    return c.body(null, 204);
  });

  app.openapi(settingsRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    for (const [kind, on] of Object.entries(c.req.valid("json")) as [AlertSetting, boolean | undefined][]) {
      if (on !== undefined) await setAlertSetting(c.env.DB, technicianId, { kind, on, now });
    }
    return c.json(await alertSettingsOf(c.env.DB, technicianId), 200);
  });

  app.openapi(subscribeRoute, async (c) => {
    const { endpoint } = c.req.valid("json");
    const now = c.var.deps.now();
    await subscribeForPushes(c.env.DB, { deviceRowId: technicianOf(c).deviceRowId, endpoint, now });
    return c.json({ endpoint, subscribed_at: now.toISOString() }, 201);
  });
}
