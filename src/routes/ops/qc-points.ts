// The points a hair system is checked against as it arrives, at Settings › Purchasing
// (docs/decisions/0283-changed-and-deleted-while-unused.md): each added, renamed, switched off, or deleted while no
// claim names it. Each change is audited under the member of staff who made it, in the same batch.

import { z } from "@hono/zod-openapi";
import { addQcPoint, changeQcPoint, deleteQcPoint, qcPoints } from "../../domain/purchasing/qc-points.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";

const QcPointSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    checked: z.boolean().openapi({ description: "Whether each hair system that arrives is checked against it." }),
    deletable: z.boolean().openapi({ description: "Whether no claim names it, so it may be deleted." }),
  })
  .strict()
  .openapi("QcPoint");

const Name = z.string().trim().min(1).max(40);
const IdParam = z.object({ id: z.string().min(1).max(64) });

const listRoute = opsRoute({
  method: "get",
  path: "/api/qc-points",
  summary: "Every point a hair system is checked against as it arrives, in order",
  responses: { 200: { description: "The points", ...json(z.object({ points: z.array(QcPointSchema) }).strict()) } },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/qc-points",
  summary: "A point added, checked, last in the order",
  request: { body: { required: true, ...json(z.object({ name: Name }).strict().openapi("NewQcPoint")) } },
  responses: {
    201: { description: "The point added", ...json(QcPointSchema) },
    400: errorResponse("invalid_request"),
    409: errorResponse("taken: another point goes by that name, however it is cased"),
  },
});

const changeRoute = opsRoute({
  method: "patch",
  path: "/api/qc-points/{id}",
  summary: "A point renamed, or switched on or off; claims already drafted keep the name they read",
  request: {
    params: IdParam,
    body: {
      required: true,
      ...json(z.object({ name: Name, checked: z.boolean() }).strict().openapi("QcPointChange")),
    },
  },
  responses: {
    200: { description: "The point as it now stands", ...json(QcPointSchema) },
    400: errorResponse("invalid_request"),
    404: errorResponse("not_found"),
    409: errorResponse("taken: another point goes by that name, however it is cased"),
  },
});

const deleteRoute = opsRoute({
  method: "delete",
  path: "/api/qc-points/{id}",
  summary: "A point deleted, while no claim names it",
  request: { params: IdParam },
  responses: {
    204: { description: "Deleted" },
    404: errorResponse("not_found"),
    409: errorResponse("in_use: a claim names it; switch it off instead"),
  },
});

export function registerOpsQcPoints(app: App): void {
  const auditOf = (c: Parameters<Parameters<App["openapi"]>[1]>[0]) =>
    ({ surface: "ops", actor: actorOf(c), requestId: c.var.requestId }) as const;

  app.openapi(listRoute, async (c) => c.json({ points: await qcPoints(c.env.DB) }, 200));

  app.openapi(addRoute, async (c) => {
    const added = await addQcPoint(c.env.DB, c.req.valid("json").name, auditOf(c), c.var.deps.now());
    return added === "taken" ? refuse(c, "taken", ["name"]) : c.json(added, 201);
  });

  app.openapi(changeRoute, async (c) => {
    const change = { id: c.req.valid("param").id, ...c.req.valid("json") };
    const changed = await changeQcPoint(c.env.DB, change, auditOf(c), c.var.deps.now());
    if (changed === "not_found") return refuse(c, "not_found");
    return changed === "taken" ? refuse(c, "taken", ["name"]) : c.json(changed, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const deleted = await deleteQcPoint(c.env.DB, c.req.valid("param").id, auditOf(c), c.var.deps.now());
    return deleted === "deleted" ? c.body(null, 204) : refuse(c, deleted);
  });
}
