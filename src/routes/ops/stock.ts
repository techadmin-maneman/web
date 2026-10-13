// Stock of consumables at each place it is kept, behind Access
// (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md; src/policy/stock.ts):
//   GET  /api/stock                 every place, what each holds of each consumable, what is low, the latest movements
//   POST /api/stock/deliveries      stock received into the national warehouse
//   POST /api/stock/transfers       stock handed to a kit, or sent to any other place to be received there
//   POST /api/stock/counts          what ops counted at a place: the ledger takes the difference
//   POST /api/stock/write-offs      a loss somebody saw, with what happened
// the places themselves (src/routes/ops/stock.places.ts), transfers received or sent back
// (src/routes/ops/stock.transit.ts), what the weeks ahead will use (src/routes/ops/stock.read.ts), and the units and
// labels of pieces (src/routes/ops/stock.units.ts).
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
import { CONSUMABLE_BOUNDS } from "../../config/consumables.ts";
import { count, receiveStock, tellOfLowStock, writeOff, type Moved } from "../../domain/field/stock.ts";
import { hairSystemSpecs } from "../../domain/field/hair-systems.ts";
import { inTransit, sendStock } from "../../domain/field/stock-transit.ts";
import { stockView } from "../../domain/field/stock-view.ts";
import { isPlaceWithin, placeAreas, placesWithin, WAREHOUSE, type Place } from "../../domain/field/stock-places.ts";
import { actorOf } from "../../http/audit.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { reachOf, routeReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { Code, Labels, LotCode, Note, PlaceId, Quantity, STOCK } from "./stock.schemas.ts";

const REFUSED = errorResponse(
  "invalid_request: fields names consumable_code for one nobody added, place_id for no place or one not in the caller's cities, lot_id for a lot the place holds none of, quantity for more pieces of a hair system than one delivery labels, or units for a label the place does not hold or a count other than the quantity",
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
          .object({
            consumable_code: Code,
            quantity: Quantity,
            note: Note.nullable().optional(),
            lot_code: LotCode.nullable().optional(),
            expires_on: z.iso.date().nullable().optional().openapi({
              description: "India's date it expires on; by default the day received plus the stock code's shelf life.",
            }),
          })
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
          .object({
            consumable_code: Code,
            quantity: Quantity,
            from: PlaceId,
            to: PlaceId,
            units: Labels.optional(),
            wait_for_scan: z.boolean().optional().openapi({
              description: "To a kit: it arrives only once the technician scans it in; by default it arrives at once.",
            }),
          })
          .strict()
          .openapi("StockTransfer"),
      ),
    },
  },
  responses: {
    200: STOCK,
    400: errorResponse(
      "invalid_request: fields names consumable_code, from, or to for the place it came from, or a place not in the caller's cities, or units for a label the place does not hold or a count other than the quantity",
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
            lot_code: LotCode.nullable().optional().openapi({
              description: "The lot any more found than was held is of, as at an opening count.",
            }),
            expires_on: z.iso.date().nullable().optional(),
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
          .object({
            consumable_code: Code,
            place_id: PlaceId,
            quantity: Quantity,
            note: Note,
            lot_id: z.string().min(1).max(64).nullable().optional().openapi({
              description: "The lot lost, as one that expired; by default the lots that expire soonest.",
            }),
            units: Labels.optional(),
          })
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
  const hairSystems = await hairSystemSpecs(c.env.DB);
  const today = indiaDate(now);
  return {
    consumables: view.consumables.map((consumable) => ({
      code: consumable.code,
      name: consumable.name,
      unit: consumable.unit,
      retired: consumable.retiredDate !== null && consumable.retiredDate <= today,
      hair_system: hairSystems.has(consumable.code),
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
      lots: holding.lots.map((lot) => ({
        id: lot.id,
        lot_code: lot.lotCode,
        expires_on: lot.expiresOn,
        quantity: lot.quantity,
      })),
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
    expiry_warning_days: (await opsInputs(c)).stockWatch.expiry_warning_days,
    max_quantity: CONSUMABLE_BOUNDS.maxQuantity,
    in_transit: (await inTransit(c.env.DB))
      .filter((transfer) => isPlaceWithin(within, transfer.from) || isPlaceWithin(within, transfer.to))
      .map((transfer) => ({
        id: transfer.id,
        consumable_code: transfer.code,
        quantity: transfer.quantity,
        from: transfer.from,
        to: transfer.to,
        sent_at: transfer.sentAt,
        sent_by: transfer.sentBy,
      })),
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

/** Pieces named by their labels number the quantity moved. */
const countsAsScanned = (body: { readonly quantity: number; readonly units?: readonly string[] }) =>
  body.units === undefined || body.units.length === body.quantity;

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
      {
        code: body.consumable_code,
        quantity: body.quantity,
        note: body.note ?? null,
        lot: { lotCode: body.lot_code ?? null, expiresOn: body.expires_on ?? null },
      },
      written(c),
    );
    return after(c, moved, [WAREHOUSE]);
  });

  app.openapi(transferRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { from: body.from, to: body.to });
    if (refused.length > 0) return outOfReach(c, refused);
    if (!countsAsScanned(body)) return refuse(c, "invalid_request", ["units"]);
    const moved = await sendStock(
      c.env.DB,
      {
        code: body.consumable_code,
        quantity: body.quantity,
        from: body.from,
        to: body.to,
        units: body.units ?? null,
        waitForScan: body.wait_for_scan === true,
      },
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
      {
        code: body.consumable_code,
        place: body.place_id,
        counted: body.counted,
        note: body.note ?? null,
        // A count names a lot only where ops give one: found stock of no known age is of no lot.
        ...((body.lot_code ?? null) === null && (body.expires_on ?? null) === null
          ? {}
          : { lot: { lotCode: body.lot_code ?? null, expiresOn: body.expires_on ?? null } }),
      },
      written(c),
    );
    return after(c, moved, [body.place_id]);
  });

  app.openapi(writeOffRoute, async (c) => {
    const body = c.req.valid("json");
    const refused = await placesOutOfReach(c, { place_id: body.place_id });
    if (refused.length > 0) return outOfReach(c, refused);
    if (!countsAsScanned(body)) return refuse(c, "invalid_request", ["units"]);
    const moved = await writeOff(
      c.env.DB,
      {
        code: body.consumable_code,
        place: body.place_id,
        quantity: body.quantity,
        note: body.note,
        lotId: body.lot_id ?? null,
        units: body.units ?? null,
      },
      written(c),
    );
    return after(c, moved, [body.place_id]);
  });
}
