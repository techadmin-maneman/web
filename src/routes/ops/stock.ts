// Stock of consumables at each place it is kept, behind Access
// (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md; src/policy/stock.ts):
//   GET  /api/stock                 every place, what each holds of each consumable, what is low, the latest movements
//   POST /api/stock/deliveries      stock received into the national warehouse
//   POST /api/stock/transfers       stock moved between any two places
//   POST /api/stock/counts          what ops counted at a place: the ledger takes the difference
//   POST /api/stock/write-offs      a loss somebody saw, with what happened
// and the places themselves (src/routes/ops/stock.places.ts).
//
// Each movement is a row of the ledger, with the Access identity behind it,
// written with its audit entry in one batch (ADR 0031); what a place holds is
// the sum of its rows. A job's use comes out of the technician's kit as their
// step lands (src/routes/tech/jobs.ts). A place that falls to its reorder level
// raises one alert, and the table marks it low. Every write answers the whole
// of GET's answer, so the screen follows it without reading again.
//
// Each keeps to the caller's cities: the kits of the technicians there and the
// stockrooms in them, a hub with every city of its zone, and the warehouse,
// which is in no city, only with a national grant.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { CONSUMABLE_BOUNDS, MAX_NOTE } from "../../config/consumables.ts";
import {
  count,
  MOVEMENT_REASONS,
  receiveStock,
  stockView,
  tellOfLowStock,
  transferStock,
  writeOff,
  type Moved,
} from "../../domain/field/stock.ts";
import {
  isPlaceWithin,
  PLACE_KINDS,
  placeAreas,
  placesWithin,
  WAREHOUSE,
  type Place,
} from "../../domain/field/stock-places.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { reachOf, routeReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";

/** A place, by its ID: "central" for the warehouse, a technician's ID for their kit. */
export const PlaceId = z
  .string()
  .min(1)
  .max(64)
  .openapi({ description: "A place by its ID: central for the warehouse, a kit by its technician's ID." });

const StockSchema = z
  .object({
    consumables: z.array(
      z
        .object({
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          retired: z.boolean().openapi({ description: "No longer offered, and still held somewhere." }),
          reorder_kit: z.union([z.number().int(), z.null()]),
          reorder_central: z.union([z.number().int(), z.null()]),
        })
        .strict(),
    ),
    places: z
      .array(
        z
          .object({
            id: PlaceId,
            kind: z.enum(PLACE_KINDS),
            name: z.string().openapi({ description: "A kit's is its technician's name." }),
            parent_id: z
              .union([PlaceId, z.null()])
              .openapi({ description: "The place it hangs from; null for the warehouse." }),
            zone: z.union([z.string(), z.null()]),
            city: z.union([z.string(), z.null()]),
            active: z.boolean().openapi({ description: "Open; a kit is open while its technician is." }),
          })
          .strict(),
      )
      .openapi({
        description:
          "Every open place down the tree, the warehouse first, and any closed one still holding stock: those in the caller's cities, a hub with every city of its zone, and the warehouse only with a national grant.",
      }),
    holdings: z.array(
      z
        .object({
          consumable_code: z.string(),
          place_id: PlaceId,
          quantity: z.number().int().openapi({ description: "The sum of the place's rows; below nought is a gap." }),
          low: z.boolean().openapi({ description: "At or below the level for its kind of place." }),
          counted_at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When it was last counted there." }),
        })
        .strict(),
    ),
    movements: z
      .array(
        z
          .object({
            at: z.iso.datetime(),
            consumable_code: z.string(),
            place_id: PlaceId,
            quantity: z.number().int().openapi({ description: "Into the place, positive; out of it, negative." }),
            reason: z.enum(MOVEMENT_REASONS),
            by: z.string().openapi({
              description:
                "Who: ops' Access identity, a service token by its label on the Staff list, or the technician's ID " +
                "for a job's use.",
            }),
            note: z.union([z.string(), z.null()]),
          })
          .strict(),
      )
      .openapi({ description: "The latest movements, newest first." }),
    today: z.iso.date(),
    max_quantity: z.number().int(),
    zones: z.array(z.string()).openapi({ description: "The zones a hub may be for." }),
    cities: z.array(z.string()).openapi({ description: "The active cities a stockroom may be in." }),
  })
  .strict()
  .openapi("Stock");

export const STOCK = { description: "What every place holds", ...json(StockSchema) };

const Code = z.string().min(1).max(64);
const Quantity = z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxQuantity);
const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^\p{Cc}]+$/u);

const REFUSED = errorResponse(
  "invalid_request: fields names consumable_code for one nobody added, or place_id for no place or one not in the caller's cities",
);

const stockRoute = createRoute({
  method: "get",
  path: "/api/stock",
  summary: "Every place, what each holds of each consumable, what is low, and the latest movements",
  responses: { 200: STOCK, 403: errorResponse("access_required") },
});

const deliveryRoute = createRoute({
  method: "post",
  path: "/api/stock/deliveries",
  summary: "Stock received into the national warehouse",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ consumable_code: Code, quantity: Quantity, note: Note.nullable().optional() })
          .strict()
          .openapi("StockDelivery"),
      ),
    },
  },
  responses: { 200: STOCK, 400: REFUSED, 403: errorResponse("access_required") },
});

const transferRoute = createRoute({
  method: "post",
  path: "/api/stock/transfers",
  summary: "Stock moved from one place to another: out of one, into the other",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ consumable_code: Code, quantity: Quantity, from: PlaceId, to: PlaceId })
          .strict()
          .openapi("StockTransfer"),
      ),
    },
  },
  responses: {
    200: STOCK,
    400: errorResponse(
      "invalid_request: fields names consumable_code, from, or to for the place it came from, or a place not in the caller's cities",
    ),
    403: errorResponse("access_required"),
  },
});

const countRoute = createRoute({
  method: "post",
  path: "/api/stock/counts",
  summary: "What ops counted at a place. The ledger takes the difference from what it held",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            consumable_code: Code,
            place_id: PlaceId,
            counted: z.number().int().min(0).max(CONSUMABLE_BOUNDS.maxQuantity),
            note: Note.nullable().optional(),
          })
          .strict()
          .openapi("StockCount"),
      ),
    },
  },
  responses: { 200: STOCK, 400: REFUSED, 403: errorResponse("access_required") },
});

const writeOffRoute = createRoute({
  method: "post",
  path: "/api/stock/write-offs",
  summary: "A loss somebody saw at a place, with what happened",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ consumable_code: Code, place_id: PlaceId, quantity: Quantity, note: Note })
          .strict()
          .openapi("StockWriteOff"),
      ),
    },
  },
  responses: { 200: STOCK, 400: REFUSED, 403: errorResponse("access_required") },
});

/** GET's answer, which every write here and on the places answers too. */
export async function stockAnswer(c: Context<AppEnv>) {
  const now = c.var.deps.now();
  const within = await placesWithin(c.env.DB, await reachOf(c, "operations", "view"));
  const view = await stockView(c.env.DB, now, within);
  const areas = await placeAreas(c.env.DB);
  const today = indiaDate(now);
  return {
    consumables: view.consumables.map((consumable) => ({
      code: consumable.code,
      name: consumable.name,
      unit: consumable.unit,
      retired: consumable.retiredDate !== null && consumable.retiredDate <= today,
      reorder_kit: consumable.reorderKit,
      reorder_central: consumable.reorderCentral,
    })),
    places: view.places.map((place) => ({
      id: place.id,
      kind: place.kind,
      name: place.name,
      parent_id: place.parentId,
      zone: place.zone,
      city: place.city,
      active: place.active,
    })),
    holdings: view.holdings.map((holding) => ({
      consumable_code: holding.code,
      place_id: holding.place,
      quantity: holding.quantity,
      low: holding.low,
      counted_at: holding.countedAt,
    })),
    movements: view.movements.map((movement) => ({
      at: movement.at,
      consumable_code: movement.code,
      place_id: movement.place,
      quantity: movement.quantity,
      reason: movement.reason,
      by: movement.by,
      note: movement.note,
    })),
    today,
    max_quantity: CONSUMABLE_BOUNDS.maxQuantity,
    ...areas,
  };
}

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

/** The fields that name a place outside the caller's cities; the warehouse is in none of them. */
async function placesOutOfReach(c: Context<AppEnv>, places: Readonly<Record<string, Place>>): Promise<string[]> {
  const within = await placesWithin(c.env.DB, await routeReach(c));
  return Object.entries(places)
    .filter(([, place]) => !isPlaceWithin(within, place))
    .map(([field]) => field);
}

const outOfReach = (c: Context<AppEnv>, fields: string[]) => refuse(c, "invalid_request", fields);

/** The movement's answer: refused, or the stock as it now stands, once each place it touched is checked for low. */
async function after(c: Context<AppEnv>, moved: Moved, touched: readonly Place[]) {
  if (!moved.ok) return refuse(c, "invalid_request", moved.fields);
  await tellOfLowStock(c.env.DB, c.var.deps, { touched, lowered: moved.lowered });
  return c.json(await stockAnswer(c), 200);
}

export function registerOpsStock(app: App): void {
  app.openapi(stockRoute, async (c) => c.json(await stockAnswer(c), 200));

  app.openapi(deliveryRoute, async (c) => {
    const body = c.req.valid("json");
    const moved = await receiveStock(
      c.env.DB,
      { code: body.consumable_code, quantity: body.quantity, note: body.note ?? null },
      written(c),
    );
    return after(c, moved, [WAREHOUSE]);
  });

  app.openapi(transferRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { from: body.from, to: body.to });
    if (refused.length > 0) return outOfReach(c, refused);
    const moved = await transferStock(
      c.env.DB,
      { code: body.consumable_code, quantity: body.quantity, from: body.from, to: body.to },
      written(c),
    );
    return after(c, moved, [body.from, body.to]);
  });

  app.openapi(countRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { place_id: body.place_id });
    if (refused.length > 0) return outOfReach(c, refused);
    const moved = await count(
      c.env.DB,
      { code: body.consumable_code, place: body.place_id, counted: body.counted, note: body.note ?? null },
      written(c),
    );
    return after(c, moved, [body.place_id]);
  });

  app.openapi(writeOffRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { place_id: body.place_id });
    if (refused.length > 0) return outOfReach(c, refused);
    const moved = await writeOff(
      c.env.DB,
      { code: body.consumable_code, place: body.place_id, quantity: body.quantity, note: body.note },
      written(c),
    );
    return after(c, moved, [body.place_id]);
  });
}
