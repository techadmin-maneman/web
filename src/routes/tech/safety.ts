// A technician's safety on a visit (docs/decisions/0248-safety.md): where they are, sent every two minutes from
// check-in to the close, and the SOS, which pages ops at once with whose it is and the visit under way, and stays open
// until ops mark it handled. "I'm safe" tells ops so, once. Each is the technician's own alone.

import { z } from "@hono/zod-openapi";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import {
  keepPosition,
  openSosOf,
  pageDue,
  raiseSos,
  sayingSafe,
  technicianNameOf,
  updateSosPosition,
  visitUnderWay,
} from "../../domain/field/safety.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import type { Context } from "hono";

const PositionSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.union([z.number().min(0).max(100_000), z.null()]),
    at: z.iso.datetime().openapi({ description: "When the phone read it." }),
  })
  .strict()
  .openapi("TechnicianPosition");

const OwnSosSchema = z
  .object({ id: z.uuid(), sent_at: z.iso.datetime(), safe: z.boolean() })
  .strict()
  .openapi("TechnicianSos");

const UNSIGNED = "session_required; device_revoked; technician_inactive: ops switched the technician off";

const positionRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/position",
  summary: "Where the technician is, from the visit's check-in to its close: the visit keeps the latest alone",
  request: { params: z.object({ id: z.uuid() }), body: { required: true, ...json(PositionSchema) } },
  responses: {
    204: { description: "Kept, in place of any earlier; an open SOS of theirs takes it too" },
    401: errorResponse(UNSIGNED),
    404: errorResponse("not_found: no such visit of this technician's"),
    409: errorResponse("not_changeable: the visit is not between its check-in and its close"),
  },
});

const ownSosRoute = techRoute({
  method: "get",
  path: "/api/tech/sos",
  summary: "The technician's SOS not yet handled by ops, if any",
  responses: {
    200: {
      description: "Theirs, or null",
      ...json(
        z
          .object({ sos: z.union([OwnSosSchema, z.null()]) })
          .strict()
          .openapi("TechnicianOwnSos"),
      ),
    },
    401: errorResponse(UNSIGNED),
  },
});

const sosRoute = techRoute({
  method: "post",
  path: "/api/tech/sos",
  summary: "Raise an SOS: ops are paged at once with the technician, the visit and where they are",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            job_id: z
              .union([z.uuid(), z.null()])
              .openapi({ description: "The visit they are on, where there is one." }),
            position: z
              .union([PositionSchema, z.null()])
              .openapi({ description: "Where they are; null where the phone has none." }),
          })
          .strict()
          .openapi("TechnicianSosRaised"),
      ),
    },
  },
  responses: {
    201: { description: "Raised, or the one already open, brought up to date", ...json(OwnSosSchema) },
    401: errorResponse(UNSIGNED),
  },
});

const sosPositionRoute = techRoute({
  method: "post",
  path: "/api/tech/sos/{id}/position",
  summary: "A closer reading of where the technician is, for their open SOS: it raises nothing again and pages nobody",
  request: { params: z.object({ id: z.uuid() }), body: { required: true, ...json(PositionSchema) } },
  responses: {
    204: { description: "Kept on the SOS, in place of an earlier reading" },
    401: errorResponse(UNSIGNED),
    404: errorResponse("not_found: no SOS of this technician's still open"),
  },
});

const safeRoute = techRoute({
  method: "post",
  path: "/api/tech/sos/{id}/safe",
  summary: "The technician says they are safe: ops are told, and mark the SOS handled",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: "Said" },
    401: errorResponse(UNSIGNED),
    404: errorResponse("not_found: no SOS of this technician's still open"),
  },
});

/**
 * Ops paged with the SOS: whose it is and the visit under way, with the console, whose banner shows where they are.
 * The page names no position, as the alert log and the logs keep it longer than the SOS.
 * A page after "I'm safe" closes that word, so a later one is told again.
 */
async function page(c: Context<AppEnv>, id: string, visit: string | null): Promise<void> {
  if (!(await pageDue(c.env.DB, { id, kind: "sos", now: c.var.deps.now() }))) return;
  const technician = await technicianNameOf(c.env.DB, technicianOf(c).technicianId);
  await c.var.deps.resolveAlert(`sos_safe:${id}`);
  await c.var.deps.alertOnce({ key: `sos:${id}`, message: ALERT_WORDS.sos({ technician, visit }), link: "/" });
}

export function registerTechSafety(app: App): void {
  app.openapi(positionRoute, async (c) => {
    const kept = await keepPosition(c.env.DB, {
      appointmentId: c.req.valid("param").id,
      technicianId: technicianOf(c).technicianId,
      position: c.req.valid("json"),
      now: c.var.deps.now(),
    });
    if (kept === "not_found") return refuse(c, "not_found");
    if (kept === "not_sharing") return refuse(c, "not_changeable");
    return c.body(null, 204);
  });

  app.openapi(ownSosRoute, async (c) => c.json({ sos: await openSosOf(c.env.DB, technicianOf(c).technicianId) }, 200));

  app.openapi(sosRoute, async (c) => {
    const { job_id: jobId, position } = c.req.valid("json");
    const technicianId = technicianOf(c).technicianId;
    const visit = jobId === null ? null : await visitUnderWay(c.env.DB, jobId, technicianId);
    const sos = await raiseSos(c.env.DB, { technicianId, appointmentId: visit, position, now: c.var.deps.now() });
    c.var.log.warn("sos_raised", { sos_id: sos.id, technician_id: technicianId, fresh: sos.fresh });
    if (sos.fresh) await page(c, sos.id, visit);
    return c.json({ id: sos.id, sent_at: sos.sent_at, safe: sos.safe }, 201);
  });

  app.openapi(sosPositionRoute, async (c) => {
    const updated = await updateSosPosition(c.env.DB, {
      id: c.req.valid("param").id,
      technicianId: technicianOf(c).technicianId,
      position: c.req.valid("json"),
    });
    return updated === "updated" ? c.body(null, 204) : refuse(c, "not_found");
  });

  app.openapi(safeRoute, async (c) => {
    const id = c.req.valid("param").id;
    const technicianId = technicianOf(c).technicianId;
    const said = await sayingSafe(c.env.DB, { id, technicianId, now: c.var.deps.now() });
    if (said === "not_found") return refuse(c, "not_found");
    // Ops are told once, and again only some minutes on; the SOS's page is closed, so one raised again is told again.
    if (said === "said" && (await pageDue(c.env.DB, { id, kind: "safe", now: c.var.deps.now() }))) {
      await c.var.deps.resolveAlert(`sos:${id}`);
      const technician = await technicianNameOf(c.env.DB, technicianId);
      await c.var.deps.alertOnce({ key: `sos_safe:${id}`, message: ALERT_WORDS.sos_safe({ technician }), link: "/" });
    }
    return c.body(null, 204);
  });
}
