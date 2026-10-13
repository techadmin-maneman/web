// A hair system's stock code, behind Access (docs/decisions/0156-hair-systems-in-stock.md):
//   POST /api/hair-systems      a stock code for a spec no other has, counted in pieces
//
// It answers the new code; the console reads GET /api/consumables again, where the code is listed with the
// consumables, and its cost, levels and retirement change as any consumable's do.

import { createRoute, z } from "@hono/zod-openapi";
import { addHairSystem } from "../../domain/field/hair-systems.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { PRICE_TIER } from "../../policy/services.ts";
import { Level, UnitCost } from "../schemas/consumables.ts";
import { FitSpecSchema } from "../schemas/hair-profile.ts";

const fit = FitSpecSchema.shape;

const addRoute = createRoute({
  method: "post",
  path: "/api/hair-systems",
  summary: "Add a hair system's stock code, counted in pieces, for a spec no other has",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            product: z.string().regex(PRICE_TIER).openapi({ description: "The tier of a first-fit service." }),
            base_width_in: fit.base_width_in.unwrap(),
            base_length_in: fit.base_length_in.unwrap(),
            colour: fit.colour.unwrap(),
            grey_percent: fit.grey_percent.unwrap(),
            density_percent: fit.density_percent.unwrap(),
            unit_cost: UnitCost,
            reorder_kit: Level.optional(),
            reorder_central: Level.optional(),
            reorder_store: Level.optional(),
          })
          .strict()
          .openapi("NewHairSystem"),
      ),
    },
  },
  responses: {
    200: { description: "Added", ...json(z.object({ code: z.string() }).strict()) },
    400: errorResponse(
      "invalid_request: fields names product for one no first fit is sold as, or hair_system for a spec, or the name it makes, another has",
    ),
    403: errorResponse("access_required"),
  },
});

export function registerOpsHairSystems(app: App): void {
  app.openapi(addRoute, async (c) => {
    const body = c.req.valid("json");
    const saved = await addHairSystem(
      c.env.DB,
      {
        product: body.product,
        baseWidthIn: body.base_width_in,
        baseLengthIn: body.base_length_in,
        colour: body.colour,
        greyPercent: body.grey_percent,
        densityPercent: body.density_percent,
        unitCost: body.unit_cost,
        reorderKit: body.reorder_kit ?? null,
        reorderCentral: body.reorder_central ?? null,
        reorderStore: body.reorder_store ?? null,
      },
      { actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() },
    );
    if (!saved.ok) return refuse(c, "invalid_request", saved.fields);
    return c.json({ code: saved.code }, 200);
  });
}
