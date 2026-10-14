// A client matched to stock, on their page in the console (docs/decisions/0173-matching-a-client-to-stock.md).
//
// Read as their hair profile is, within the reader's places.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { MATCHED_FIELDS, stockMatch } from "../../domain/inventory/stock-match.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";

const StockMatchSchema = z
  .object({
    kind: z.enum(["no_profile", "incomplete", "custom", "stocked"]),
    missing: z
      .array(z.enum(MATCHED_FIELDS))
      .openapi({ description: "What the profile lacks; empty unless incomplete." }),
    code: z.string().nullable(),
    name: z.string().nullable(),
    city: z.string().nullable(),
    held: z.array(
      z.object({
        place_id: z.string(),
        name: z.string(),
        kind: z.string(),
        city: z.string().nullable(),
        pieces: z.number().int(),
      }),
    ),
    in_transit: z.number().int(),
  })
  .openapi("ClientStockMatch");

const matchRoute = opsRoute({
  method: "get",
  path: "/api/clients/{id}/stock-match",
  summary: "The stock code the client's hair profile matches exactly, and where its pieces are",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The match", ...json(StockMatchSchema) },
    404: errorResponse("not_found: no such client within the reader's places"),
  },
});

export function registerOpsStockMatch(app: App): void {
  app.openapi(matchRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const match = await stockMatch(c.env.DB, id);
    const stocked = match.kind === "stocked" ? match : null;
    return c.json(
      {
        kind: match.kind,
        missing: match.kind === "incomplete" ? [...match.missing] : [],
        code: stocked?.code ?? null,
        name: stocked?.name ?? null,
        city: stocked?.city ?? null,
        held: (stocked?.held ?? []).map((place) => ({
          place_id: place.placeId,
          name: place.name,
          kind: place.kind,
          city: place.city,
          pieces: place.pieces,
        })),
        in_transit: stocked?.inTransit ?? 0,
      },
      200,
    );
  });
}
