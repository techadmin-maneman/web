// The places stock is kept, behind Access (docs/decisions/0155-the-stock-place-tree.md):
//   POST /api/stock/places          a hub for a zone, or a stockroom in a city, under a place above it
//   POST /api/stock/places/{id}     a place renamed, moved under another, or closed or opened again; a kit only moved
//
// Both need a national grant to manage operations, and answer the whole of GET /api/stock, so the screen follows
// without reading again. A technician's kit comes with them, under the warehouse until it is moved.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { addPlace, changePlace } from "../../domain/field/stock-places.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { PlaceId, STOCK, stockAnswer } from "./stock.ts";

const Name = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\p{Cc}]+$/u);

const MANAGE_ONLY = "access_required, or not_permitted: changing a place asks Operations MANAGE everywhere";

const addRoute = createRoute({
  method: "post",
  path: "/api/stock/places",
  summary: "A hub for a zone, or a stockroom in a city, under a place above it",
  request: {
    body: {
      required: true,
      ...json(
        z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("hub"), name: Name, parent_id: PlaceId, zone: z.string().min(1) }).strict(),
            z
              .object({ kind: z.literal("stockroom"), name: Name, parent_id: PlaceId, city: z.string().min(1) })
              .strict(),
          ])
          .openapi("StockPlaceAdd"),
      ),
    },
  },
  responses: {
    200: STOCK,
    400: errorResponse(
      "invalid_request: fields names name for one another place has, parent_id for no open place above it, or zone or city for none of ours",
    ),
    403: errorResponse(MANAGE_ONLY),
  },
});

const changeRoute = createRoute({
  method: "post",
  path: "/api/stock/places/{id}",
  summary: "A place renamed, moved under another, or closed or opened again; a kit only moved",
  request: {
    params: z.object({ id: PlaceId }),
    body: {
      required: true,
      ...json(
        z
          .object({ name: Name.optional(), parent_id: PlaceId.optional(), active: z.boolean().optional() })
          .strict()
          .refine((change) => Object.keys(change).length > 0)
          .openapi("StockPlaceChange"),
      ),
    },
  },
  responses: {
    200: STOCK,
    400: errorResponse(
      "invalid_request: fields names name for a kit or one another place has, parent_id for the warehouse or no open place above it, or active for the warehouse, a kit, a place still holding stock or with an open place under it, or one under a closed place",
    ),
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such place"),
  },
});

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsStockPlaces(app: App): void {
  app.openapi(addRoute, async (c) => {
    const body = c.req.valid("json");
    const area = body.kind === "hub" ? body.zone : body.city;
    const added = await addPlace(
      c.env.DB,
      { kind: body.kind, name: body.name, parentId: body.parent_id, area },
      written(c),
    );
    if (!added.ok) return refuse(c, "invalid_request", added.fields);
    return c.json(await stockAnswer(c), 200);
  });

  app.openapi(changeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const changed = await changePlace(
      c.env.DB,
      id,
      { name: body.name, parentId: body.parent_id, active: body.active },
      written(c),
    );
    if (!changed.ok)
      return "missing" in changed ? refuse(c, "not_found") : refuse(c, "invalid_request", changed.fields);
    return c.json(await stockAnswer(c), 200);
  });
}
