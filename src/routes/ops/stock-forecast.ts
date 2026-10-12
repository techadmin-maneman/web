// The demand forecast, behind Access (docs/decisions/0179-demand-forecast.md):
//   GET /api/stock/forecast?city=   the latest run: its period and horizon, the rates it learned, and each stock code's
//                                   expected use in each city and period, with what each layer gave
//
// Read with Operations VIEW.

import { createRoute, z } from "@hono/zod-openapi";
import { latestForecast } from "../../domain/field/forecast.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";

const Figure = z.number();

const ForecastSchema = z
  .object({
    run: z
      .object({
        run_on: z.iso.date(),
        period_days: z.number().int(),
        horizon_periods: z.number().int(),
        due_rate: z.number().openapi({ description: "The share of clients due taken to book their replacement." }),
        fit_rate: z.number().openapi({ description: "The share of consultations taken to become a first fit." }),
      })
      .nullable()
      .openapi({ description: "Null before the first run." }),
    lines: z.array(
      z.object({
        consumable_code: z.string(),
        name: z.string(),
        city: z.string(),
        period: z.number().int(),
        booked: Figure,
        due: Figure,
        pipeline: Figure,
        baseline: Figure,
        expected: Figure,
        high: Figure,
      }),
    ),
  })
  .openapi("DemandForecast");

const forecastRoute = createRoute({
  method: "get",
  path: "/api/stock/forecast",
  summary: "The latest demand forecast, for one city or every city",
  request: { query: z.object({ city: z.string().min(1).max(80).optional() }) },
  responses: { 200: { description: "The forecast", ...json(ForecastSchema) }, 403: errorResponse("access_required") },
});

export function registerOpsForecast(app: App): void {
  app.openapi(forecastRoute, async (c) => {
    const forecast = await latestForecast(c.env.DB, c.req.valid("query").city ?? null);
    return c.json(
      {
        run:
          forecast === null
            ? null
            : {
                run_on: forecast.runOn,
                period_days: forecast.periodDays,
                horizon_periods: forecast.horizonPeriods,
                due_rate: forecast.dueRate,
                fit_rate: forecast.fitRate,
              },
        lines: (forecast?.lines ?? []).map((line) => ({
          consumable_code: line.code,
          name: line.name,
          city: line.city,
          period: line.period,
          booked: line.booked,
          due: line.due,
          pipeline: line.pipeline,
          baseline: line.baseline,
          expected: line.expected,
          high: line.high,
        })),
      },
      200,
    );
  });
}
