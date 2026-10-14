// Failure rates and value at risk, behind Access (docs/decisions/0188-failure-rates-and-value-at-risk.md):
//   GET /api/quality/failures   the labelled pieces fitted in the last year and how many failed, by stock code, lot,
//                               supplier and technician
//   GET /api/stock/expiry-risk  each lot that will not all be used before it expires at its place's pace, valued at
//                               its landed cost, with what to do about it
//
// Failure rates read with Operations VIEW; the value at risk with MANAGE in the caller's places, since it values stock.

import { createRoute, z } from "@hono/zod-openapi";
import { placesWithin } from "../../domain/inventory/stock-places.ts";
import { expiryRisk, failureRates, type FailureGroup } from "../../domain/inventory/stock-quality.ts";
import type { App } from "../../http/context.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";

const Group = z.object({
  name: z.string(),
  fitted: z.number().int(),
  failed: z.number().int(),
  rate_percent: z.number().nullable(),
});

const failuresRoute = createRoute({
  method: "get",
  path: "/api/quality/failures",
  summary: "The labelled pieces fitted in the last year and how many failed, four ways",
  responses: {
    200: {
      description: "Failure rates",
      ...json(
        z
          .object({
            since: z.iso.date(),
            by_code: z.array(Group),
            by_lot: z.array(Group),
            by_supplier: z.array(Group),
            by_technician: z.array(Group),
          })
          .openapi("FailureRates"),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const riskRoute = createRoute({
  method: "get",
  path: "/api/stock/expiry-risk",
  summary: "Each lot that will not all be used before it expires, valued at its landed cost",
  responses: {
    200: {
      description: "Value at risk",
      ...json(
        z
          .object({
            total_value: z.number().openapi({ description: "In paise." }),
            lots: z.array(
              z.object({
                place_id: z.string(),
                place: z.string(),
                consumable_code: z.string(),
                name: z.string(),
                lot_code: z.string(),
                expires_on: z.iso.date(),
                quantity: z.number(),
                value: z.number().openapi({ description: "In paise, at the lot's landed cost." }),
                suggestion: z.enum(["write_off", "move", "use_first"]),
                move_to: z.string().nullable(),
              }),
            ),
          })
          .openapi("ExpiryRisk"),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const groupJson = (group: FailureGroup) => ({
  name: group.name,
  fitted: group.fitted,
  failed: group.failed,
  rate_percent: group.ratePercent,
});

export function registerOpsStockQuality(app: App): void {
  app.openapi(failuresRoute, async (c) => {
    const since = addDays(indiaDate(c.var.deps.now()), -(await opsInputs(c)).stockQuality.failure_days);
    const rates = await failureRates(c.env.DB, since);
    return c.json(
      {
        since,
        by_code: rates.byCode.map(groupJson),
        by_lot: rates.byLot.map(groupJson),
        by_supplier: rates.bySupplier.map(groupJson),
        by_technician: rates.byTechnician.map(groupJson),
      },
      200,
    );
  });

  app.openapi(riskRoute, async (c) => {
    const today = indiaDate(c.var.deps.now());
    const paceDays = (await opsInputs(c)).stockQuality.pace_days;
    const since = indiaInstant(addDays(today, -paceDays), "00:00").toISOString();
    const within = await placesWithin(c.env.DB, await routeReach(c));
    const lots = await expiryRisk(c.env.DB, { today, since, paceDays }, within);
    return c.json(
      {
        total_value: lots.reduce((total, lot) => total + lot.value, 0),
        lots: lots.map((lot) => ({
          place_id: lot.placeId,
          place: lot.place,
          consumable_code: lot.code,
          name: lot.name,
          lot_code: lot.lotCode,
          expires_on: lot.expiresOn,
          quantity: lot.quantity,
          value: lot.value,
          suggestion: lot.suggestion,
          move_to: lot.moveTo,
        })),
      },
      200,
    );
  });
}
