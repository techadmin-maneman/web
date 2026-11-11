// A technician's safety on a visit (docs/decisions/0248-safety.md): where they are, sent every two minutes from
// check-in to the close, and the SOS, which pages ops at once with whose it is, the visit and a map, and stays open
// until ops mark it handled. "I'm safe" tells ops so. Each is the technician's own alone.

import { z } from "@hono/zod-openapi";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import {
  keepPosition,
  openSosList,
  openSosOf,
  raiseSos,
  sayingSafe,
  type Position,
} from "../../domain/field/safety.ts";
import { workableJob } from "../../domain/field/workable-job.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { mapLink } from "../../policy/safety.ts";
import type { Context } from "hono";

const PositionSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(100_000).nullable(),
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
      ...json(z.object({ sos: OwnSosSchema.nullable() }).strict().openapi("TechnicianOwnSos")),
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
            job_id: z.uuid().nullable().openapi({ description: "The visit they are on, where there is one." }),
            position: PositionSchema.nullable().openapi({
              description: "Where they are; null where the phone has none.",
            }),
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

/** The visit, where it is the technician's own; null for any other, or none. */
async function ownVisit(c: Context<AppEnv>, id: string | null): Promise<string | null> {
  if (id === null) return null;
  const job = await workableJob(c.env.DB, id);
  return job?.technicianId === technicianOf(c).technicianId ? job.id : null;
}

/** Ops paged with the SOS: whose it is, the visit they were on, and a map where the phone gave where they are. */
async function page(c: Context<AppEnv>, id: string, position: Position | null): Promise<void> {
  const sos = (await openSosList(c.env.DB)).find((one) => one.id === id);
  if (sos === undefined) return;
  await c.var.deps.alertOnce({
    key: `sos:${id}`,
    message: ALERT_WORDS.sos({
      technician: sos.technician.name,
      visit: sos.visit?.id ?? null,
      map: position === null ? null : mapLink(position),
    }),
    link: "/",
  });
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
    const sos = await raiseSos(c.env.DB, {
      technicianId,
      appointmentId: await ownVisit(c, jobId),
      position,
      now: c.var.deps.now(),
    });
    c.var.log.warn("sos_raised", { sos_id: sos.id, technician_id: technicianId, fresh: sos.fresh });
    if (sos.fresh) await page(c, sos.id, position);
    return c.json({ id: sos.id, sent_at: sos.sent_at, safe: sos.safe }, 201);
  });

  app.openapi(safeRoute, async (c) => {
    const id = c.req.valid("param").id;
    const technicianId = technicianOf(c).technicianId;
    const said = await sayingSafe(c.env.DB, { id, technicianId, now: c.var.deps.now() });
    if (said === "not_found") return refuse(c, "not_found");
    const sos = (await openSosList(c.env.DB)).find((one) => one.id === id);
    await c.var.deps.alertOnce({
      key: `sos_safe:${id}`,
      message: ALERT_WORDS.sos_safe({ technician: sos?.technician.name ?? technicianId }),
      link: "/",
    });
    return c.body(null, 204);
  });
}
