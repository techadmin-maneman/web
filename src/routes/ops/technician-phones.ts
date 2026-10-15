// A technician's phones (./field.ts): one revoked, which drops its cached jobs and stops them signing in, and their
// sign-in allowed again after a revoke, or once their number has had its login codes for today.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { json } from "../../http/openapi.ts";
import { allowSignIn, revokeDevice } from "../../domain/dispatch/technicians.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { withinRouteReach } from "../../http/staff-access.ts";

const revokeRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/devices/{device}/revoke",
  summary: "Revoke a phone. Its session ends, and it drops its cached jobs on its next contact",
  request: { params: z.object({ id: z.uuid(), device: z.string().min(1).max(64) }) },
  responses: {
    200: { description: "Revoked", ...json(z.object({ revoked_at: z.iso.datetime() }).strict()) },
    404: errorResponse("not_found: no such phone of that technician's, or they are not in the caller's cities"),
  },
});

const allowSignInRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/allow-sign-in",
  summary:
    "Let a technician sign in again, on any phone: after ops revoked one of theirs, or once their number has had " +
    "its login codes for today",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "They may sign in again", ...json(z.object({ allowed: z.literal(true) }).strict()) },
    404: errorResponse(
      "not_found: no such technician stopped signing in or out of codes, or they are not in the caller's cities",
    ),
  },
});

export function registerOpsTechnicianPhones(app: App): void {
  app.openapi(revokeRoute, async (c) => {
    const staff = actorOf(c);
    const { id, device } = c.req.valid("param");
    const now = c.var.deps.now();
    if (!(await withinRouteReach(c, "technician", id))) return refuse(c, "not_found");

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
    if (revokedAt === null) return refuse(c, "not_found");
    c.var.log.info("technician_device_revoked", { technician_id: id, device_id: device });
    return c.json({ revoked_at: revokedAt }, 200);
  });

  app.openapi(allowSignInRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "technician", id))) return refuse(c, "not_found");
    const audit = {
      surface: "ops",
      actor: actorOf(c),
      action: "technician.allow_sign_in",
      subject: { kind: "technician", id },
      requestId: c.var.requestId,
    } as const;
    const { settings } = c.var.config;
    const count = { salt: settings.ipHashSalt, settings };
    if (!(await allowSignIn(c.env.DB, id, { audit, count }, c.var.deps.now()))) {
      return refuse(c, "not_found");
    }
    c.var.log.info("technician_sign_in_allowed", { technician_id: id });
    return c.json({ allowed: true as const }, 200);
  });
}
