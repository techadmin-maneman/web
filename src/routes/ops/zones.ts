// Admin › Cities' zones (docs/decisions/0109-console-departments-and-access.md): a region of cities, as NCR is, which a
// grant of staff access may name and a city is put in from its own row. Each is audited under who added it.

import { z } from "@hono/zod-openapi";
import { addZone, deleteZone, renameZone, zoneNames } from "../../domain/cities/zones.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";

/** A zone's name: letters first, then letters, figures, spaces, dots, hyphens and apostrophes. */
const ZONE_NAME = /^\p{L}[\p{L}\d .'-]{0,39}$/u;

const addZoneRoute = opsRoute({
  method: "post",
  path: "/api/zones",
  summary: "A zone added, last in the order: a region of cities a grant of staff access may name",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ name: z.string().trim().regex(ZONE_NAME) })
          .strict()
          .openapi("NewZone"),
      ),
    },
  },
  responses: {
    201: {
      description: "The zones as they now stand, in order",
      ...json(z.object({ zones: z.array(z.string()) }).strict()),
    },
    400: errorResponse("invalid_request"),
    409: errorResponse("taken: a zone goes by that name already, however it is cased"),
  },
});

const ZonesSchema = z
  .object({ zones: z.array(z.string()) })
  .strict()
  .openapi("Zones");
const ZoneParams = z.object({ name: z.string().min(1).max(40) });

const renameZoneRoute = opsRoute({
  method: "patch",
  path: "/api/zones/{name}",
  summary: "A zone renamed: its cities, stock places, technicians and the staff grants over it follow, in one batch",
  request: {
    params: ZoneParams,
    body: {
      required: true,
      ...json(
        z
          .object({ name: z.string().trim().regex(ZONE_NAME) })
          .strict()
          .openapi("ZoneRename"),
      ),
    },
  },
  responses: {
    200: { description: "The zones as they now stand, in order", ...json(ZonesSchema) },
    400: errorResponse("invalid_request"),
    404: errorResponse("not_found: no zone goes by that name"),
    409: errorResponse("taken: another zone goes by the new name, however it is cased"),
  },
});

const deleteZoneRoute = opsRoute({
  method: "post",
  path: "/api/zones/{name}/delete",
  summary: "A zone deleted, while no city, stock place, technician or staff grant names it",
  request: { params: ZoneParams },
  responses: {
    200: { description: "The zones as they now stand, in order", ...json(ZonesSchema) },
    404: errorResponse("not_found: no zone goes by that name"),
    409: errorResponse("in_use: a city, stock place, technician or staff grant names it"),
  },
});

export function registerOpsZones(app: App): void {
  app.openapi(renameZoneRoute, async (c) => {
    const audit = { surface: "ops", actor: actorOf(c), requestId: c.var.requestId } as const;
    const change = { from: c.req.valid("param").name, to: c.req.valid("json").name };
    const renamed = await renameZone(c.env.DB, change, audit, c.var.deps.now());
    if (renamed === "not_found") return refuse(c, "not_found");
    if (renamed === "taken") return refuse(c, "taken", ["name"]);
    return c.json({ zones: await zoneNames(c.env.DB) }, 200);
  });
  app.openapi(deleteZoneRoute, async (c) => {
    const audit = { surface: "ops", actor: actorOf(c), requestId: c.var.requestId } as const;
    const deleted = await deleteZone(c.env.DB, c.req.valid("param").name, audit, c.var.deps.now());
    if (deleted === "not_found") return refuse(c, "not_found");
    if (deleted === "in_use") return refuse(c, "in_use");
    return c.json({ zones: await zoneNames(c.env.DB) }, 200);
  });
  app.openapi(addZoneRoute, async (c) => {
    const { name } = c.req.valid("json");
    const audit = { surface: "ops", actor: actorOf(c), requestId: c.var.requestId } as const;
    const added = await addZone(c.env.DB, name, audit, c.var.deps.now());
    if (added === "taken") return refuse(c, "taken", ["name"]);
    return c.json({ zones: await zoneNames(c.env.DB) }, 201);
  });
}
