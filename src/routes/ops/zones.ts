// Admin › Cities' zones (docs/decisions/0109-console-departments-and-access.md): a region of cities, as NCR is, which a
// grant of staff access may name and a city is put in from its own row. Each is audited under who added it.

import { z } from "@hono/zod-openapi";
import { addZone, zoneNames } from "../../domain/cities/zones.ts";
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

export function registerOpsZones(app: App): void {
  app.openapi(addZoneRoute, async (c) => {
    const { name } = c.req.valid("json");
    const audit = { surface: "ops", actor: actorOf(c), requestId: c.var.requestId } as const;
    const added = await addZone(c.env.DB, name, audit, c.var.deps.now());
    if (added === "taken") return refuse(c, "taken", ["name"]);
    return c.json({ zones: await zoneNames(c.env.DB) }, 201);
  });
}
