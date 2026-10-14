// How right the forecast was (docs/decisions/0183-forecast-accuracy.md): once a run's first period has passed, each
// stock code and city's expected use and high case is kept beside what the kits used in it, fitted pieces among them;
// read back as the Supply plan shows it, a city's last periods and each item across them.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import {
  ACCURACY_PERIODS_SHOWN,
  biasPercent,
  errorPercent,
  withinHighPercent,
  type Measured,
} from "../../policy/forecast-accuracy.ts";
import { read, readAll } from "../../lib/read-all.ts";

/** How many lines one statement writes. */
const LINES_A_STATEMENT = 400;

type ExpectedRow = { code: string; city: string; expected: number; high: number };
type UsedRow = { code: string; city: string; used: number };

/**
 * The latest run whose first period has passed and was not yet measured, measured: its lines beside what was used,
 * and a stock code used that it never expected as one expected at nought. The run measured, or null.
 */
export async function measureLastForecast(db: D1Database, now: Date, today: string): Promise<string | null> {
  const run = await db
    .prepare(
      `SELECT id, run_on, period_days FROM forecast_runs INDEXED BY forecast_runs_unmeasured
       WHERE measured_at IS NULL AND date(run_on, '+' || period_days || ' days') <= ?1
       ORDER BY run_on DESC LIMIT 1`,
    )
    .bind(today)
    .first<{ id: string; run_on: string; period_days: number }>();
  if (run === null) return null;
  const end = addDays(run.run_on, run.period_days);
  const { expected, used } = await readAll(db, {
    expected: read<ExpectedRow>(
      db
        .prepare(
          `SELECT consumable_code AS code, city, expected, high FROM forecast_lines WHERE run_id = ?1 AND period = 0`,
        )
        .bind(run.id),
    ),
    used: read<UsedRow>(
      db
        .prepare(
          `SELECT m.consumable_code AS code, COALESCE(t.city, '') AS city, SUM(-m.quantity) AS used
         FROM stock_movements m INDEXED BY stock_movements_used_by_day
         LEFT JOIN technicians t ON t.id = COALESCE(m.technician_id, m.place_id)
         WHERE m.reason = 'used' AND m.created_at >= ?1 AND m.created_at < ?2 GROUP BY 1, 2`,
        )
        .bind(indiaInstant(run.run_on, "00:00").toISOString(), indiaInstant(end, "00:00").toISOString()),
    ),
  });
  const lines = new Map<string, { code: string; city: string } & Measured>();
  for (const row of expected) lines.set(`${row.code}|${row.city}`, { ...row, actual: 0 });
  for (const row of used) {
    const key = `${row.code}|${row.city}`;
    const line = lines.get(key) ?? { code: row.code, city: row.city, expected: 0, high: 0, actual: 0 };
    lines.set(key, { ...line, actual: line.actual + row.used });
  }
  const all = [...lines.values()];
  const chunks = Array.from({ length: Math.ceil(all.length / LINES_A_STATEMENT) }, (_, index) =>
    all.slice(index * LINES_A_STATEMENT, (index + 1) * LINES_A_STATEMENT),
  );
  const at = now.toISOString();
  await db.batch([
    ...chunks.map((chunk) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO forecast_accuracy (run_id, consumable_code, city, period_start, period_days, expected,
             high, actual, measured_at)
           SELECT ?1, json_extract(value, '$.code'), json_extract(value, '$.city'), ?2, ?3,
             json_extract(value, '$.expected'), json_extract(value, '$.high'), json_extract(value, '$.actual'), ?4
           FROM json_each(?5)`,
        )
        .bind(run.id, run.run_on, run.period_days, at, JSON.stringify(chunk)),
    ),
    db.prepare("UPDATE forecast_runs SET measured_at = ?2 WHERE id = ?1").bind(run.id, at),
  ]);
  return run.id;
}

export interface PeriodAccuracy {
  readonly periodStart: string;
  readonly periodDays: number;
  readonly expected: number;
  readonly actual: number;
  readonly errorPercent: number | null;
  readonly biasPercent: number | null;
  readonly withinHighPercent: number | null;
}

export interface ItemAccuracy {
  readonly code: string;
  readonly name: string;
  readonly expected: number;
  readonly actual: number;
  readonly errorPercent: number | null;
  readonly biasPercent: number | null;
}

type AccuracyRow = {
  code: string;
  name: string;
  period_start: string;
  period_days: number;
  expected: number;
  high: number;
  actual: number;
};

const tenths = (value: number) => Math.round(value * 10) / 10;

function totalsOf(lines: readonly Measured[]) {
  return {
    expected: tenths(lines.reduce((total, line) => total + line.expected, 0)),
    actual: tenths(lines.reduce((total, line) => total + line.actual, 0)),
    errorPercent: errorPercent(lines),
    biasPercent: biasPercent(lines),
  };
}

/** A city's last measured periods, newest first, and each item across them, the furthest off first. */
export async function forecastAccuracy(
  db: D1Database,
  city: string,
): Promise<{ periods: PeriodAccuracy[]; items: ItemAccuracy[] }> {
  const { results } = await db
    .prepare(
      `SELECT a.consumable_code AS code, COALESCE(c.name, a.consumable_code) AS name, a.period_start, a.period_days,
         a.expected, a.high, a.actual
       FROM forecast_accuracy a INDEXED BY forecast_accuracy_by_city LEFT JOIN consumables c ON c.code = a.consumable_code
       WHERE a.city = ?1 AND a.period_start IN (
         SELECT DISTINCT period_start FROM forecast_accuracy INDEXED BY forecast_accuracy_by_city WHERE city = ?1
         ORDER BY period_start DESC LIMIT ?2)`,
    )
    .bind(city, ACCURACY_PERIODS_SHOWN)
    .all<AccuracyRow>();
  const byPeriod = Map.groupBy(results, (row) => row.period_start);
  const byItem = Map.groupBy(results, (row) => row.code);
  const periods = [...byPeriod]
    .map(([periodStart, lines]) => ({
      periodStart,
      periodDays: lines[0]?.period_days ?? 0,
      ...totalsOf(lines),
      withinHighPercent: withinHighPercent(lines),
    }))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const missOf = (lines: readonly Measured[]) =>
    lines.reduce((total, line) => total + Math.abs(line.expected - line.actual), 0);
  const items = [...byItem]
    .sort(([, a], [, b]) => missOf(b) - missOf(a))
    .map(([code, lines]) => ({ code, name: lines[0]?.name ?? code, ...totalsOf(lines) }));
  return { periods, items };
}
