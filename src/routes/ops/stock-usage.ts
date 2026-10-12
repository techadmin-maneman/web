// Usage against expected, and shrinkage, behind Access (docs/decisions/0186-usage-and-shrinkage.md):
//   GET /api/stock/usage   over the last weeks, each technician's use beside what their visits were expected to use,
//                          and each place's losses, write-offs and first-time counts, the flagged first
//
// Read with Operations MANAGE in the caller's places: it values stock at cost.

import { createRoute, z } from "@hono/zod-openapi";
import { placesWithin } from "../../domain/field/stock-places.ts";
import { shrinkage, usageAgainstExpected } from "../../domain/field/stock-usage.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach } from "../../http/staff-access.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { USAGE_DAYS } from "../../policy/stock-usage.ts";

const Percent = z.number().nullable();
const Paise = z.number().openapi({ description: "In paise, at each item's cost." });

const UsageSchema = z
  .object({
    since: z.iso.date(),
    technicians: z.array(
      z.object({
        technician_id: z.string(),
        name: z.string(),
        visits: z.number().int(),
        expected_value: Paise,
        used_value: Paise,
        over_percent: Percent.openapi({ description: "Above nought where use ran over expected." }),
        flagged: z.boolean(),
        items: z.array(
          z.object({
            consumable_code: z.string(),
            name: z.string(),
            expected: z.number(),
            used: z.number(),
            over_percent: Percent,
          }),
        ),
      }),
    ),
    places: z.array(
      z.object({
        place_id: z.string(),
        place: z.string(),
        kind: z.string(),
        left_value: Paise,
        lost_value: Paise,
        write_offs: z.number().int(),
        shrinkage_percent: Percent,
        count_accuracy_percent: Percent,
        flagged: z.boolean(),
      }),
    ),
  })
  .openapi("StockUsage");

const usageRoute = createRoute({
  method: "get",
  path: "/api/stock/usage",
  summary: "Each technician's use beside expected, and each place's losses, over the last weeks",
  responses: {
    200: { description: "Usage and shrinkage", ...json(UsageSchema) },
    403: errorResponse("access_required"),
  },
});

export function registerOpsStockUsage(app: App): void {
  app.openapi(usageRoute, async (c) => {
    const since = addDays(indiaDate(c.var.deps.now()), -USAGE_DAYS);
    const within = await placesWithin(c.env.DB, await routeReach(c));
    const [technicians, places] = await Promise.all([
      usageAgainstExpected(c.env.DB, since, within),
      shrinkage(c.env.DB, indiaInstant(since, "00:00").toISOString(), within),
    ]);
    return c.json(
      {
        since,
        technicians: technicians.map((technician) => ({
          technician_id: technician.technicianId,
          name: technician.name,
          visits: technician.visits,
          expected_value: technician.expectedValue,
          used_value: technician.usedValue,
          over_percent: technician.overPercent,
          flagged: technician.flagged,
          items: technician.items.map((item) => ({
            consumable_code: item.code,
            name: item.name,
            expected: item.expected,
            used: item.used,
            over_percent: item.overPercent,
          })),
        })),
        places: places.map((place) => ({
          place_id: place.placeId,
          place: place.place,
          kind: place.kind,
          left_value: place.leftValue,
          lost_value: place.lostValue,
          write_offs: place.writeOffs,
          shrinkage_percent: place.shrinkagePercent,
          count_accuracy_percent: place.countAccuracyPercent,
          flagged: place.flagged,
        })),
      },
      200,
    );
  });
}
