// What the weeks ahead will use, behind Access (docs/decisions/0160-demand-and-opening-counts.md):
//   GET /api/stock/demand      each stock code's expected use by city over the next four weeks, beside what the city
//                              holds, and the fits booked whose hair system is not in their city
//
// It keeps to the caller's cities: a city reached, and visits of no city found only with a national grant.

import { createRoute, z } from "@hono/zod-openapi";
import { stockDemand } from "../../domain/field/stock-demand.ts";
import type { App } from "../../http/context.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { reachOf } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";

const DemandSchema = z
  .object({
    days: z.number().int().openapi({ description: "How far ahead the visits booked are read." }),
    demand: z.array(
      z
        .object({
          consumable_code: z.string(),
          city: z.union([z.string(), z.null()]),
          expected: z.number().int().openapi({ description: "What the visits booked are expected to use." }),
          held: z.number().int().openapi({ description: "What the city's places hold now, a kit in its city." }),
        })
        .strict(),
    ),
    at_risk: z
      .array(
        z
          .object({
            appointment_id: z.string(),
            window_start: z.iso.datetime(),
            city: z.union([z.string(), z.null()]),
            consumable_code: z.union([z.string(), z.null()]).openapi({
              description: "The hair system it needs; null where the client has no profile to match one by.",
            }),
          })
          .strict(),
      )
      .openapi({ description: "Fits booked whose hair system no place in their city holds enough of, soonest first." }),
  })
  .strict()
  .openapi("StockDemand");

const demandRoute = createRoute({
  method: "get",
  path: "/api/stock/demand",
  summary: "What the next four weeks' visits will use, by city, beside what each city holds",
  responses: {
    200: { description: "The demand ahead", ...json(DemandSchema) },
    403: errorResponse("access_required"),
  },
});

export function registerOpsStockDemand(app: App): void {
  app.openapi(demandRoute, async (c) => {
    const reached = await reachOf(c, "operations", "view");
    const within = (city: string | null) =>
      reached.kind === "everywhere" || (city !== null && reached.cities.has(city));
    const days = (await opsInputs(c)).stockWatch.demand_days;
    const { demand, atRisk } = await stockDemand(c.env.DB, indiaDate(c.var.deps.now()), days);
    return c.json(
      {
        days,
        demand: demand
          .filter((row) => within(row.city))
          .map((row) => ({ consumable_code: row.code, city: row.city, expected: row.expected, held: row.held })),
        at_risk: atRisk
          .filter((fit) => within(fit.city))
          .map((fit) => ({
            appointment_id: fit.appointmentId,
            window_start: fit.date,
            city: fit.city,
            consumable_code: fit.code,
          })),
      },
      200,
    );
  });
}
