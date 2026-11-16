// The client's alerts in their app (src/domain/clients/app-alerts.ts; docs/decisions/0255-client-alerts-and-push.md):
// the inbox, read; the inbox marked read once opened; and the session's push subscription, kept until it is signed out,
// revoked or ends.

import { z } from "@hono/zod-openapi";
import { clientInboxOf, markClientAlertsRead, subscribeClientPushes } from "../../domain/clients/app-alerts.ts";
import { MESSAGE_KINDS } from "../../config/message-kinds.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { WHATSAPP_ONLY } from "../../policy/client-alerts.ts";
import { isPushEndpoint } from "../../providers/web-push.ts";
import { LIVE_UPDATE_KINDS } from "../../domain/visits/live-visit.ts";

const KINDS = [
  ...MESSAGE_KINDS.filter((kind) => !(WHATSAPP_ONLY as readonly string[]).includes(kind)),
  "sign_off_asked",
];

const AlertSchema = z
  .object({
    id: z.string(),
    kind: z.enum(KINDS as [string, ...string[]]).openapi({
      description: "The message it stands beside, by its kind, or sign_off_asked: the technician asks for a sign-off.",
    }),
    visit_id: z.union([z.string(), z.null()]).openapi({ description: "The visit it is about, where it is about one." }),
    update: z
      .union([
        z.object({ kind: z.enum(LIVE_UPDATE_KINDS), minutes: z.union([z.number().int(), z.null()]) }).strict(),
        z.null(),
      ])
      .openapi({ description: "A technician's word: on the way, running late or at the gate, with their minutes." }),
    at: z.iso.datetime(),
    read: z.boolean(),
  })
  .strict()
  .openapi("ClientAlert");

const AlertsSchema = z
  .object({
    alerts: z.array(AlertSchema).openapi({ description: "The last 30 days', newest first." }),
    push_key: z.union([z.string(), z.null()]).openapi({
      description: "The key a browser subscribes to our pushes with; null where pushes are not set up.",
    }),
  })
  .strict()
  .openapi("ClientAlerts");

const alertsRoute = clientRoute({
  method: "get",
  path: "/api/me/alerts",
  summary: "The client's alerts of the last 30 days, newest first",
  responses: {
    200: { description: "The inbox", ...json(AlertsSchema) },
    401: errorResponse("session_required"),
  },
});

const readRoute = clientRoute({
  method: "post",
  path: "/api/me/alerts/read",
  summary: "Every alert the client has, read: they opened the inbox",
  responses: { 204: { description: "Read" }, 401: errorResponse("session_required") },
});

const PushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      .refine(isPushEndpoint, "a browser's push service")
      .openapi({ description: "The push service's address for this browser, as it gave it." }),
  })
  .strict()
  .openapi("ClientPushSubscription");

const subscribeRoute = clientRoute({
  method: "post",
  path: "/api/me/push-subscriptions",
  summary: "This browser takes the client's pushes, until it is signed out, revoked or ends",
  request: { body: { required: true, ...json(PushSubscriptionSchema) } },
  responses: {
    201: {
      description: "Kept",
      ...json(
        z.object({ endpoint: z.string(), subscribed_at: z.iso.datetime() }).strict().openapi("ClientPushSubscribed"),
      ),
    },
    400: errorResponse("invalid_request: not a browser's push service"),
    401: errorResponse("session_required"),
  },
});

export function registerClientAppAlerts(app: App): void {
  app.openapi(alertsRoute, async (c) => {
    const alerts = await clientInboxOf(c.env.DB, clientOf(c).subjectId, c.var.deps.now());
    return c.json({ alerts, push_key: c.var.config.settings.push?.publicKey ?? null }, 200);
  });

  app.openapi(readRoute, async (c) => {
    await markClientAlertsRead(c.env.DB, clientOf(c).subjectId, c.var.deps.now());
    return c.body(null, 204);
  });

  app.openapi(subscribeRoute, async (c) => {
    const { endpoint } = c.req.valid("json");
    const now = c.var.deps.now();
    await subscribeClientPushes(c.env.DB, { sessionId: clientOf(c).id, endpoint, now });
    return c.json({ endpoint, subscribed_at: now.toISOString() }, 201);
  });
}
