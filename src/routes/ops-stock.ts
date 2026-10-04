// Stock of consumables in each technician's kit and the central store, behind Access
// (docs/decisions/0087-consumables-and-stock.md; src/policy/stock.ts):
//   GET  /api/stock                 what each place holds of each consumable, what is low, and the latest movements
//   POST /api/stock/deliveries      stock received into the central store
//   POST /api/stock/transfers       stock moved between the store and a kit, or between two kits
//   POST /api/stock/counts          what ops counted at a place: the ledger takes the difference
//   POST /api/stock/write-offs      a loss somebody saw, with what happened
//
// Each movement is a row of the ledger, with the Access identity behind it,
// written with its audit entry in one batch (ADR 0031); what a place holds is
// the sum of its rows. A job's use comes out of the technician's kit as his
// step lands (src/routes/tech-jobs.ts). A place that falls to its reorder level
// raises one alert, and the table marks it low. Every write answers the whole
// of GET's answer, so the screen follows it without reading again.
//
// Each keeps to the caller's cities: the kits of the technicians there, and the
// central store, which is in no city, only with a national grant.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { CONSUMABLE_BOUNDS, MAX_NOTE } from "../config/consumables.ts";
import {
  count,
  MOVEMENT_REASONS,
  receive,
  stockView,
  tellOfLowStock,
  transfer,
  writeOff,
  type Moved,
  type Place,
} from "../domain/stock.ts";
import { isWithin, techniciansWithin } from "../domain/places.ts";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { reachOf, routeReach } from "../http/staff-access.ts";
import { indiaDate } from "../lib/india-time.ts";

/** A place: a technician's kit by his ID, or the central store as null. */
const PlaceId = z
  .union([z.uuid(), z.null()])
  .openapi({ description: "A technician's kit, by the technician's ID; null for the central store." });

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
            technician_id: PlaceId,
            name: z.union([z.string(), z.null()]).openapi({ description: "The technician's; null for the store." }),
            active: z.boolean(),
          })
          .strict(),
      )
      .openapi({
        description:
          "The central store first, then each active technician's kit, and any other still holding stock: those in the caller's cities, and the store only with a national grant.",
      }),
    holdings: z.array(
      z
        .object({
          consumable_code: z.string(),
          technician_id: PlaceId,
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
            technician_id: PlaceId,
            quantity: z.number().int().openapi({ description: "Into the place, positive; out of it, negative." }),
            reason: z.enum(MOVEMENT_REASONS),
            by: z
              .string()
              .openapi({ description: "Who: ops' Access identity, or the technician's ID for a job's use." }),
            note: z.union([z.string(), z.null()]),
          })
          .strict(),
      )
      .openapi({ description: "The latest movements, newest first." }),
    today: z.iso.date(),
    max_quantity: z.number().int(),
  })
  .strict()
  .openapi("Stock");

const STOCK = { description: "What every place holds", ...json(StockSchema) };

const Code = z.string().min(1).max(64);
const Quantity = z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxQuantity);
const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^\p{Cc}]+$/u);

const REFUSED = errorResponse(
  "invalid_request: fields names consumable_code for one nobody added, or the place no technician is or one not in the caller's cities",
);

const stockRoute = createRoute({
  method: "get",
  path: "/api/stock",
  summary: "What each kit and the central store hold of each consumable, what is low, and the latest movements",
  responses: { 200: STOCK, 403: errorResponse("access_required") },
});

const deliveryRoute = createRoute({
  method: "post",
  path: "/api/stock/deliveries",
  summary: "Stock received into the central store",
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
            technician_id: PlaceId,
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
          .object({ consumable_code: Code, technician_id: PlaceId, quantity: Quantity, note: Note })
          .strict()
          .openapi("StockWriteOff"),
      ),
    },
  },
  responses: { 200: STOCK, 400: REFUSED, 403: errorResponse("access_required") },
});

async function answer(c: Context<AppEnv>) {
  const now = c.var.deps.now();
  const kits = await techniciansWithin(c.env.DB, await reachOf(c, "operations", "view"));
  const view = await stockView(c.env.DB, now, kits);
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
    places: view.places.map((place) => ({ technician_id: place.technicianId, name: place.name, active: place.active })),
    holdings: view.holdings.map((holding) => ({
      consumable_code: holding.code,
      technician_id: holding.technicianId,
      quantity: holding.quantity,
      low: holding.low,
      counted_at: holding.countedAt,
    })),
    movements: view.movements.map((movement) => ({
      at: movement.at,
      consumable_code: movement.code,
      technician_id: movement.technicianId,
      quantity: movement.quantity,
      reason: movement.reason,
      by: movement.by,
      note: movement.note,
    })),
    today,
    max_quantity: CONSUMABLE_BOUNDS.maxQuantity,
  };
}

const written = (c: Context<AppEnv>) => ({ actor: staffOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

/** The fields that name a place outside the caller's cities; the central store is in none of them. */
async function placesOutOfReach(c: Context<AppEnv>, places: Readonly<Record<string, Place>>): Promise<string[]> {
  const kits = await techniciansWithin(c.env.DB, await routeReach(c));
  return Object.entries(places)
    .filter(([, place]) => !isWithin(kits, place))
    .map(([field]) => field);
}

const outOfReach = (c: Context<AppEnv>, fields: string[]) =>
  c.json(errorBody("invalid_request", c.var.requestId, fields), 400);

/** The movement's answer: refused, or the stock as it now stands, once each place it touched is checked for low. */
async function after(c: Context<AppEnv>, moved: Moved, touched: readonly Place[]) {
  if (!moved.ok) return c.json(errorBody("invalid_request", c.var.requestId, moved.fields), 400);
  await tellOfLowStock(c.env.DB, c.var.deps, { touched, lowered: moved.lowered });
  return c.json(await answer(c), 200);
}

export function registerOpsStock(app: App): void {
  app.openapi(stockRoute, async (c) => c.json(await answer(c), 200));

  app.openapi(deliveryRoute, async (c) => {
    const body = c.req.valid("json");
    const moved = await receive(
      c.env.DB,
      { code: body.consumable_code, quantity: body.quantity, note: body.note ?? null },
      written(c),
    );
    return after(c, moved, [null]);
  });

  app.openapi(transferRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { from: body.from, to: body.to });
    if (refused.length > 0) return outOfReach(c, refused);
    const moved = await transfer(
      c.env.DB,
      { code: body.consumable_code, quantity: body.quantity, from: body.from, to: body.to },
      written(c),
    );
    return after(c, moved, [body.from, body.to]);
  });

  app.openapi(countRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { technician_id: body.technician_id });
    if (refused.length > 0) return outOfReach(c, refused);
    const moved = await count(
      c.env.DB,
      { code: body.consumable_code, place: body.technician_id, counted: body.counted, note: body.note ?? null },
      written(c),
    );
    return after(c, moved, [body.technician_id]);
  });

  app.openapi(writeOffRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { technician_id: body.technician_id });
    if (refused.length > 0) return outOfReach(c, refused);
    const moved = await writeOff(
      c.env.DB,
      { code: body.consumable_code, place: body.technician_id, quantity: body.quantity, note: body.note },
      written(c),
    );
    return after(c, moved, [body.technician_id]);
  });
}
