// Labels, behind Access (docs/decisions/0161-pieces-as-units.md):
//   GET  /api/stock/units               the units a place holds of a hair system, to print their labels, and how many
//                                       pieces it holds that were never labelled
//   POST /api/stock/units               labels for pieces a place held before labels
//   POST /api/stock/lots/{id}/label     a lot's label, for its boxes, made the first time it is asked for
//
// The units keep to the caller's cities, as the place does.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { auditStatement } from "../../domain/ops/audit.ts";
import { isPlaceWithin, placesWithin } from "../../domain/field/stock-places.ts";
import { hairSystemProduct, heldUnits, labelHeld, lotLabel, MAX_LABELLED } from "../../domain/field/stock-units.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { PlaceId } from "./stock.ts";

const Code = z.string().min(1).max(64);

const UnitsSchema = z
  .object({
    consumable_code: z.string(),
    place_id: PlaceId,
    units: z
      .array(
        z
          .object({
            code: z.string().openapi({ description: "The label, as its QR code holds it." }),
            lot_code: z.union([z.string(), z.null()]),
            expires_on: z.union([z.iso.date(), z.null()]),
            labelled_at: z.iso.datetime(),
          })
          .strict(),
      )
      .openapi({ description: "The units the place holds, the latest labelled first." }),
    unlabelled: z.number().int().openapi({ description: "Pieces the place holds that were never labelled." }),
    max_labelled: z.number().int().openapi({ description: "The most pieces one labelling labels." }),
  })
  .strict()
  .openapi("StockUnits");

const UNITS = { description: "The units a place holds of a hair system", ...json(UnitsSchema) };

const REFUSED = errorResponse(
  "invalid_request: fields names consumable_code for a stock code that is not a hair system, or place_id for a place not in the caller's cities",
);

const unitsRoute = createRoute({
  method: "get",
  path: "/api/stock/units",
  summary: "The units a place holds of a hair system, and how many pieces it holds unlabelled",
  request: { query: z.object({ consumable_code: Code, place_id: PlaceId }) },
  responses: { 200: UNITS, 400: REFUSED, 403: errorResponse("access_required") },
});

const labelRoute = createRoute({
  method: "post",
  path: "/api/stock/units",
  summary: "Labels for pieces a place held before labels, soonest to expire first",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            consumable_code: Code,
            place_id: PlaceId,
            quantity: z.number().int().min(1).max(MAX_LABELLED),
          })
          .strict()
          .openapi("StockLabelling"),
      ),
    },
  },
  responses: { 200: UNITS, 400: REFUSED, 403: errorResponse("access_required") },
});

const lotLabelRoute = createRoute({
  method: "post",
  path: "/api/stock/lots/{id}/label",
  summary: "A lot's label, for its boxes, made the first time it is asked for",
  request: { params: z.object({ id: z.string().min(1).max(64) }) },
  responses: {
    200: {
      description: "The lot's label",
      ...json(
        z
          .object({ label: z.string().openapi({ description: "As its QR code holds it." }) })
          .strict()
          .openapi("StockLotLabel"),
      ),
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such lot"),
  },
});

/** The fields refused: a stock code that is not a hair system, or a place out of reach. Else the product. */
async function hairSystemAt(
  c: Context<AppEnv>,
  code: string,
  place: string,
): Promise<{ readonly product: string } | { readonly fields: string[] }> {
  if (!isPlaceWithin(await placesWithin(c.env.DB, await routeReach(c)), place)) return { fields: ["place_id"] };
  const product = await hairSystemProduct(c.env.DB, code);
  return product === null ? { fields: ["consumable_code"] } : { product };
}

async function unitsAnswer(c: Context<AppEnv>, code: string, place: string) {
  const held = await heldUnits(c.env.DB, code, place);
  return {
    consumable_code: code,
    place_id: place,
    units: held.units.map((unit) => ({
      code: unit.code,
      lot_code: unit.lotCode,
      expires_on: unit.expiresOn,
      labelled_at: unit.labelledAt,
    })),
    unlabelled: held.unlabelled,
    max_labelled: MAX_LABELLED,
  };
}

export function registerOpsStockUnits(app: App): void {
  app.openapi(unitsRoute, async (c) => {
    const query = c.req.valid("query");
    const found = await hairSystemAt(c, query.consumable_code, query.place_id);
    if ("fields" in found) return refuse(c, "invalid_request", found.fields);
    return c.json(await unitsAnswer(c, query.consumable_code, query.place_id), 200);
  });

  app.openapi(labelRoute, async (c) => {
    const body = c.req.valid("json");
    const found = await hairSystemAt(c, body.consumable_code, body.place_id);
    if ("fields" in found) return refuse(c, "invalid_request", found.fields);
    const now = c.var.deps.now();
    const audit = auditStatement(
      c.env.DB,
      {
        surface: "ops",
        actor: actorOf(c),
        action: "stock.label",
        subject: { kind: "consumable", id: body.consumable_code },
        requestId: c.var.requestId,
        detail: { place: body.place_id, quantity: body.quantity },
      },
      now,
    );
    await labelHeld(
      c.env.DB,
      { code: body.consumable_code, product: found.product, place: body.place_id, quantity: body.quantity },
      { at: now.toISOString(), actor: actorOf(c).id },
      audit,
    );
    return c.json(await unitsAnswer(c, body.consumable_code, body.place_id), 200);
  });

  app.openapi(lotLabelRoute, async (c) => {
    const label = await lotLabel(c.env.DB, c.req.valid("param").id);
    if (label === null) return refuse(c, "not_found");
    return c.json({ label }, 200);
  });
}
