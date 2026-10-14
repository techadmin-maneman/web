// Transfers in transit, behind Access (docs/decisions/0158-transfers-in-transit.md).
//
// Receiving keeps to the caller's cities at the place it was sent to, and sending back at the place it left. Each
// answers the whole of GET /api/stock, so the screen follows without reading again.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { tellOfLowStock } from "../../domain/inventory/stock.ts";
import { placesWithin, isPlaceWithin } from "../../domain/inventory/stock-places.ts";
import { receiveTransfer, sendBack, type Settled } from "../../domain/inventory/stock-transit.ts";
import { written } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { CONSUMABLE_BOUNDS, MAX_NOTE } from "../../config/consumables.ts";
import { Labels, STOCK } from "./stock.schemas.ts";
import { stockAnswer } from "./stock.ts";

const transferPath = { params: z.object({ id: z.string().min(1).max(64) }) };

const SETTLED = errorResponse("transfer_settled: the transfer was received or sent back already");
const MISSING = errorResponse("not_found: no such transfer, or one not in the caller's cities");

const receiveRoute = createRoute({
  method: "post",
  path: "/api/stock/transfers/{id}/receive",
  summary: "A transfer received at the place it was sent to, in full or short",
  request: {
    ...transferPath,
    body: {
      required: true,
      ...json(
        z
          .object({
            received: z.number().int().min(0).max(CONSUMABLE_BOUNDS.maxQuantity).optional().openapi({
              description: "What arrived; all of it unless said. Less is what was lost on the way.",
            }),
            note: z
              .string()
              .trim()
              .min(1)
              .max(MAX_NOTE)
              .regex(/^[^\p{Cc}]+$/u)
              .nullable()
              .optional(),
            units: Labels.optional().openapi({
              description: "A hair system's pieces that arrived, by their labels; those not named went missing.",
            }),
          })
          .strict()
          .openapi("StockTransferReceived"),
      ),
    },
  },
  responses: {
    200: STOCK,
    400: errorResponse(
      "invalid_request: fields names received for more than was sent, id for a place that is gone, or units for a label the transfer does not carry or a count other than received",
    ),
    403: errorResponse("access_required"),
    404: MISSING,
    409: SETTLED,
  },
});

const sendBackRoute = createRoute({
  method: "post",
  path: "/api/stock/transfers/{id}/send-back",
  summary: "A transfer sent back to where it left, before it arrived",
  request: transferPath,
  responses: {
    200: STOCK,
    400: errorResponse("invalid_request: fields names id for a transfer whose place is gone"),
    403: errorResponse("access_required"),
    404: MISSING,
    409: SETTLED,
  },
});

/** Whether the transfer's end the caller settles it at is within their cities. */
async function endWithin(c: Context<AppEnv>, id: string, end: "to_place" | "from_place"): Promise<boolean> {
  const row = await c.env.DB.prepare(`SELECT ${end} AS place FROM stock_transfers WHERE id = ?1`)
    .bind(id)
    .first<{ place: string }>();
  return row !== null && isPlaceWithin(await placesWithin(c.env.DB, await routeReach(c)), row.place);
}

async function after(c: Context<AppEnv>, settled: Settled) {
  if (!settled.ok) {
    if ("missing" in settled) return refuse(c, "not_found");
    if ("settled" in settled) return refuse(c, "transfer_settled");
    return refuse(c, "invalid_request", settled.fields);
  }
  await tellOfLowStock(c.env.DB, c.var.deps, { touched: settled.touched, lowered: [] });
  return c.json(await stockAnswer(c), 200);
}

export function registerOpsStockTransit(app: App): void {
  app.openapi(receiveRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await endWithin(c, id, "to_place"))) return refuse(c, "not_found");
    const body = c.req.valid("json");
    const units = body.units ?? null;
    if (units !== null && body.received !== undefined && body.received !== units.length) {
      return refuse(c, "invalid_request", ["units"]);
    }
    const received = { received: body.received ?? null, note: body.note ?? null, units };
    return after(c, await receiveTransfer(c.env.DB, id, received, written(c)));
  });

  app.openapi(sendBackRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await endWithin(c, id, "from_place"))) return refuse(c, "not_found");
    return after(c, await sendBack(c.env.DB, id, written(c)));
  });
}
