// The demand forecast, behind Access (docs/decisions/0179-demand-forecast.md).
//
// Read with Operations VIEW.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { latestForecast } from "../../domain/purchasing/forecast.ts";
import { forecastAccuracy } from "../../domain/purchasing/forecast-accuracy.ts";
import type { App } from "../../http/context.ts";
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

const forecastRoute = opsRoute({
  method: "get",
  path: "/api/stock/forecast",
  summary: "The latest demand forecast, for one city or every city",
  request: { query: z.object({ city: z.string().min(1).max(80).optional() }) },
  responses: { 200: { description: "The forecast", ...json(ForecastSchema) } },
});

const Percent = z.number().int().nullable().openapi({ description: "Null where nothing was used." });

const AccuracySchema = z
  .object({
    periods: z.array(
      z.object({
        period_start: z.iso.date(),
        period_days: z.number().int(),
        expected: Figure,
        actual: Figure,
        error_percent: Percent,
        bias_percent: Percent.openapi({
          description: "Above nought where the forecast ran high. Null where nothing was used.",
        }),
        within_high_percent: z.number().int().nullable(),
      }),
    ),
    items: z.array(
      z.object({
        consumable_code: z.string(),
        name: z.string(),
        expected: Figure,
        actual: Figure,
        error_percent: Percent,
        bias_percent: Percent,
      }),
    ),
  })
  .openapi("ForecastAccuracy");

const accuracyRoute = opsRoute({
  method: "get",
  path: "/api/stock/forecast-accuracy",
  summary: "How right the forecast was in one city: its last measured periods, and each item across them",
  request: { query: z.object({ city: z.string().max(80) }) },
  responses: { 200: { description: "The accuracy", ...json(AccuracySchema) } },
});

export function registerOpsForecast(app: App): void {
  app.openapi(accuracyRoute, async (c) => {
    const { periods, items } = await forecastAccuracy(c.env.DB, c.req.valid("query").city);
    return c.json(
      {
        periods: periods.map((period) => ({
          period_start: period.periodStart,
          period_days: period.periodDays,
          expected: period.expected,
          actual: period.actual,
          error_percent: period.errorPercent,
          bias_percent: period.biasPercent,
          within_high_percent: period.withinHighPercent,
        })),
        items: items.map((item) => ({
          consumable_code: item.code,
          name: item.name,
          expected: item.expected,
          actual: item.actual,
          error_percent: item.errorPercent,
          bias_percent: item.biasPercent,
        })),
      },
      200,
    );
  });

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
