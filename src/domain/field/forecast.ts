// The demand forecast (docs/decisions/0179-demand-forecast.md): run once each planning period from the hourly stock
// watch, it adds up its four layers (./forecast-layers.ts) for each stock code, city and period of the horizon, and
// keeps each line with what each layer gave, so a figure always says why it is what it is. Runs older than the
// learning days are let go.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { expectedOf, highOf, LEARNING_DAYS } from "../../policy/forecast.ts";
import { baselineLayer, bookedLayer, dueLayer, pipelineLayer, type Horizon } from "./forecast-layers.ts";

/** How many lines one statement writes. */
const LINES_A_STATEMENT = 400;

interface ForecastLine {
  readonly code: string;
  readonly city: string;
  readonly period: number;
  readonly booked: number;
  readonly due: number;
  readonly pipeline: number;
  readonly baseline: number;
  readonly expected: number;
  readonly high: number;
}

const tenths = (value: number) => Math.round(value * 10) / 10;

/** Every line of the horizon any layer expects something of. */
async function linesOf(db: D1Database, horizon: Horizon) {
  const [booked, due, pipeline, baseline] = await Promise.all([
    bookedLayer(db, horizon),
    dueLayer(db, horizon),
    pipelineLayer(db, horizon),
    baselineLayer(db, horizon),
  ]);
  const keys = new Set([...booked.keys(), ...due.layer.keys(), ...pipeline.layer.keys(), ...baseline.keys()]);
  const lines = [...keys].flatMap((key): ForecastLine[] => {
    const [code = "", city = "", period = "0"] = key.split("|");
    const layers = {
      booked: tenths(booked.get(key) ?? 0),
      due: tenths(due.layer.get(key) ?? 0),
      pipeline: tenths(pipeline.layer.get(key) ?? 0),
      baseline: tenths(baseline.get(key) ?? 0),
    };
    const expected = expectedOf(layers);
    return expected > 0 ? [{ code, city, period: Number(period), ...layers, expected, high: highOf(expected) }] : [];
  });
  return { lines, dueRate: due.rate, fitRate: pipeline.rate };
}

/**
 * The forecast run for today, where none has run within the planning period. The run's ID; null where one is not due.
 */
export async function runForecastIfDue(
  db: D1Database,
  now: Date,
  settings: { readonly planningPeriodDays: number; readonly planningHorizonPeriods: number },
): Promise<string | null> {
  const today = indiaDate(now);
  const last = await db
    .prepare("SELECT run_on FROM forecast_runs INDEXED BY forecast_runs_by_day ORDER BY run_on DESC LIMIT 1")
    .first<string>("run_on");
  if (last !== null && addDays(last, settings.planningPeriodDays) > today) return null;
  const horizon = { today, periodDays: settings.planningPeriodDays, horizonPeriods: settings.planningHorizonPeriods };
  const { lines, dueRate, fitRate } = await linesOf(db, horizon);
  const id = crypto.randomUUID();
  const chunks = Array.from({ length: Math.ceil(lines.length / LINES_A_STATEMENT) }, (_, index) =>
    lines.slice(index * LINES_A_STATEMENT, (index + 1) * LINES_A_STATEMENT),
  );
  const forgotten = addDays(today, -LEARNING_DAYS);
  await db.batch([
    db
      .prepare(
        `INSERT INTO forecast_runs (id, run_on, period_days, horizon_periods, due_rate, fit_rate, ran_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(id, today, horizon.periodDays, horizon.horizonPeriods, dueRate, fitRate, now.toISOString()),
    ...chunks.map((chunk) =>
      db
        .prepare(
          `INSERT INTO forecast_lines (run_id, consumable_code, city, period, booked, due, pipeline, baseline, expected,
             high)
           SELECT ?1, json_extract(value, '$.code'), json_extract(value, '$.city'), json_extract(value, '$.period'),
             json_extract(value, '$.booked'), json_extract(value, '$.due'), json_extract(value, '$.pipeline'),
             json_extract(value, '$.baseline'), json_extract(value, '$.expected'), json_extract(value, '$.high')
           FROM json_each(?2)`,
        )
        .bind(id, JSON.stringify(chunk)),
    ),
    db
      .prepare(
        `DELETE FROM forecast_lines WHERE run_id IN (SELECT id FROM forecast_runs INDEXED BY forecast_runs_by_day
                                                     WHERE run_on < ?1)`,
      )
      .bind(forgotten),
    db.prepare("DELETE FROM forecast_runs WHERE run_on < ?1").bind(forgotten),
  ]);
  return id;
}

export interface Forecast {
  readonly runOn: string;
  readonly periodDays: number;
  readonly horizonPeriods: number;
  readonly dueRate: number;
  readonly fitRate: number;
  readonly lines: ForecastLine[];
}

type LineRow = {
  consumable_code: string;
  city: string;
  period: number;
  booked: number;
  due: number;
  pipeline: number;
  baseline: number;
  expected: number;
  high: number;
};

/** The latest run, its lines for the city given or every city; null before the first run. */
export async function latestForecast(db: D1Database, city: string | null): Promise<Forecast | null> {
  const run = await db
    .prepare(
      `SELECT id, run_on, period_days, horizon_periods, due_rate, fit_rate FROM forecast_runs
       INDEXED BY forecast_runs_by_day ORDER BY run_on DESC LIMIT 1`,
    )
    .first<{
      id: string;
      run_on: string;
      period_days: number;
      horizon_periods: number;
      due_rate: number;
      fit_rate: number;
    }>();
  if (run === null) return null;
  const { results } = await db
    .prepare(
      `SELECT consumable_code, city, period, booked, due, pipeline, baseline, expected, high FROM forecast_lines
       WHERE run_id = ?1 AND (?2 IS NULL OR city = ?2) ORDER BY city, consumable_code, period`,
    )
    .bind(run.id, city)
    .all<LineRow>();
  return {
    runOn: run.run_on,
    periodDays: run.period_days,
    horizonPeriods: run.horizon_periods,
    dueRate: run.due_rate,
    fitRate: run.fit_rate,
    lines: results.map((row) => ({
      code: row.consumable_code,
      city: row.city,
      period: row.period,
      booked: row.booked,
      due: row.due,
      pipeline: row.pipeline,
      baseline: row.baseline,
      expected: row.expected,
      high: row.high,
    })),
  };
}
