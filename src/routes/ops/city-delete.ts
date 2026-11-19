// A city deleted at Admin › Cities, its own prices and rules with it, while nothing else names it
// (docs/decisions/0283-changed-and-deleted-while-unused.md); audited under the member of staff who asked, in its batch.

import { z } from "@hono/zod-openapi";
import { deleteCity } from "../../domain/cities/city-delete.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { opsRoute } from "../../http/session-routes.ts";

const deleteRoute = opsRoute({
  method: "delete",
  path: "/api/cities/{name}",
  summary: "A city deleted, its own prices and rules with it, while nothing else names it",
  request: { params: z.object({ name: z.string().min(1).max(60) }) },
  responses: {
    204: { description: "Deleted" },
    404: errorResponse("not_found: no such city"),
    409: errorResponse("in_use: a client, visit, pincode, technician, stock or staff access names it"),
  },
});

export function registerOpsCityDelete(app: App): void {
  app.openapi(deleteRoute, async (c) => {
    const audit = { surface: "ops", actor: actorOf(c), requestId: c.var.requestId } as const;
    const deleted = await deleteCity(c.env.DB, c.req.valid("param").name, audit, c.var.deps.now());
    return deleted === "deleted" ? c.body(null, 204) : refuse(c, deleted);
  });
}
