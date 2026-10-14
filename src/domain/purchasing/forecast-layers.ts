// The demand forecast's four layers (docs/decisions/0179-demand-forecast.md), each read as what it expects of each
// stock code in each city in each period of the horizon, keyed "code|city|period":
//   booked    the first fits and replacements booked, each the hair system made to its client, and every booked
//             visit's consumables by its service's expected use;
//   due       each fitted piece falling due, the hair system made to its client, weighted by how often clients due book;
//   pipeline  each consultation booked, weighted by how often one becomes a first fit, landing the usual days later,
//             spread across the hair systems its city's fits have used;
//   baseline  what each city used of each item over its last periods, as a period's worth, lifted by the events ops keep.

import { latestFits } from "../clients/hair-profiles.ts";
import { addDays } from "../../lib/india-time.ts";
import { learnedRate, periodOf, type ForecastAssumptions } from "../../policy/forecast.ts";
import { hairSystemSpecs, matchingCode } from "../inventory/hair-systems.ts";
import { tierOf } from "../../config/visit-types.ts";
import { bookedAhead } from "../../config/statuses.ts";
import { visitCity } from "../clients/places.ts";
import { read, readAll } from "../../lib/read-all.ts";

export interface Horizon {
  readonly today: string;
  readonly periodDays: number;
  readonly horizonPeriods: number;
  /** What the layers learn from and assume, as ops set it (`forecast_assumptions`). */
  readonly assumptions: ForecastAssumptions;
}

export type LayerMap = Map<string, number>;

const keyOf = (code: string, city: string | null, period: number) => `${code}|${city ?? ""}|${String(period)}`;

const add = (map: LayerMap, key: string, quantity: number) => map.set(key, (map.get(key) ?? 0) + quantity);

const lastDay = (horizon: Horizon) => addDays(horizon.today, horizon.periodDays * horizon.horizonPeriods);

const dayOf = (instant: string) => instant.slice(0, 10);

const periodIn = (horizon: Horizon, day: string) =>
  periodOf(day, horizon.today, horizon.periodDays, horizon.horizonPeriods);

type FitRow = {
  person_id: string;
  type: string;
  tier: string | null;
  window_start: string;
  city: string | null;
};

/** The visits booked in the horizon: each fit's hair system, and each visit's consumables. */
export async function bookedLayer(db: D1Database, horizon: Horizon): Promise<LayerMap> {
  const { fits, used } = await readAll(db, {
    fits: read<FitRow>(
      db
        .prepare(
          `SELECT a.person_id, a.type, a.tier, a.window_start, ${visitCity("a")} AS city
         FROM appointments a
         WHERE ${bookedAhead("a")} AND a.type IN ('first_fit', 'replacement')`,
        )
        .bind(horizon.today, lastDay(horizon)),
    ),
    used: read<{
      code: string;
      city: string | null;
      window_start: string;
      quantity: number;
    }>(
      db
        .prepare(
          `SELECT u.consumable_code AS code, ${visitCity("a")} AS city, a.window_start, u.quantity
         FROM appointments a JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = ${tierOf("a.tier")}
         WHERE ${bookedAhead("a")}`,
        )
        .bind(horizon.today, lastDay(horizon)),
    ),
  });
  const layer: LayerMap = new Map();
  for (const row of used) {
    const period = periodIn(horizon, dayOf(row.window_start));
    if (period !== null) add(layer, keyOf(row.code, row.city, period), row.quantity);
  }
  const fitRows = fits;
  const profiles = await latestFits(
    db,
    fitRows.map((fit) => fit.person_id),
  );
  const specs = await hairSystemSpecs(db);
  for (const fit of fitRows) {
    const profile = profiles.get(fit.person_id);
    const period = periodIn(horizon, dayOf(fit.window_start));
    if (profile === undefined || period === null) continue;
    const product = fit.type === "first_fit" ? (fit.tier ?? "standard") : profile.product;
    const code = matchingCode(specs, { ...profile, product });
    if (code !== null) add(layer, keyOf(code, fit.city, period), 1);
  }
  return layer;
}

type DueRow = { person_id: string; due: string; city: string | null };

/** The share of pieces that fell due over the learning days whose replacement was booked. */
async function dueRate(db: D1Database, horizon: Horizon): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS due, COALESCE(SUM(replacement_booked), 0) AS booked FROM pieces INDEXED BY pieces_by_due
       WHERE date(replacement_due_at) >= ?1 AND date(replacement_due_at) < ?2 AND deleted_at IS NULL`,
    )
    .bind(addDays(horizon.today, -horizon.assumptions.learning_days), horizon.today)
    .first<{ due: number; booked: number }>();
  const { due_booking_percent: fallback, enough_to_learn: enough } = horizon.assumptions;
  return learnedRate(row?.booked ?? 0, row?.due ?? 0, fallback, enough);
}

/** The pieces falling due in the horizon, each the hair system made to its client, weighted by the rate learned. */
export async function dueLayer(db: D1Database, horizon: Horizon): Promise<{ layer: LayerMap; rate: number }> {
  const rate = await dueRate(db, horizon);
  const { results } = await db
    .prepare(
      `SELECT p.person_id, p.replacement_due_at AS due, ${visitCity("a")} AS city
       FROM pieces p INDEXED BY pieces_to_replace JOIN people pe ON pe.id = p.person_id
       LEFT JOIN appointments a ON a.id = p.appointment_id
       WHERE p.replacement_booked = 0 AND p.deleted_at IS NULL AND p.failed_at IS NULL AND p.replaced_at IS NULL
         AND p.replacement_due_at IS NOT NULL AND p.replacement_due_at >= ?1 AND p.replacement_due_at < ?2
         AND pe.erased_at IS NULL`,
    )
    .bind(horizon.today, lastDay(horizon))
    .all<DueRow>();
  const profiles = await latestFits(
    db,
    results.map((row) => row.person_id),
  );
  const specs = await hairSystemSpecs(db);
  const layer: LayerMap = new Map();
  for (const row of results) {
    const profile = profiles.get(row.person_id);
    const period = periodIn(horizon, dayOf(row.due));
    if (profile === undefined || period === null) continue;
    const code = matchingCode(specs, profile);
    if (code !== null) add(layer, keyOf(code, row.city, period), rate);
  }
  return { layer, rate };
}

/** Each city's share of the hair systems its fits used over the learning days, by code. */
async function cityMix(db: D1Database, horizon: Horizon): Promise<Map<string, { code: string; share: number }[]>> {
  const { results } = await db
    .prepare(
      `SELECT m.consumable_code AS code, t.city, SUM(-m.quantity) AS used FROM stock_movements m INDEXED BY stock_movements_used_by_day
       JOIN hair_systems h ON h.code = m.consumable_code
       JOIN technicians t ON t.id = COALESCE(m.technician_id, m.place_id)
       WHERE m.reason = 'used' AND m.created_at >= ?1 GROUP BY 1, 2`,
    )
    .bind(addDays(horizon.today, -horizon.assumptions.learning_days))
    .all<{ code: string; city: string | null; used: number }>();
  const totals = new Map<string, number>();
  for (const row of results) totals.set(row.city ?? "", (totals.get(row.city ?? "") ?? 0) + row.used);
  const mix = new Map<string, { code: string; share: number }[]>();
  for (const row of results) {
    const total = totals.get(row.city ?? "") ?? 0;
    if (total <= 0 || row.used <= 0) continue;
    mix.set(row.city ?? "", [...(mix.get(row.city ?? "") ?? []), { code: row.code, share: row.used / total }]);
  }
  return mix;
}

/** The share of consultations held over the learning days whose client went on to book a first fit. */
async function fitRate(db: D1Database, horizon: Horizon): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS consulted,
         COALESCE(SUM(EXISTS (SELECT 1 FROM appointments f WHERE f.person_id = c.person_id AND f.type = 'first_fit'
                              AND f.deleted_at IS NULL)), 0) AS fitted
       FROM appointments c WHERE c.window_start >= ?1 AND c.window_start < ?2 AND c.type = 'consultation'
         AND c.status = 'completed'`,
    )
    .bind(addDays(horizon.today, -horizon.assumptions.learning_days), horizon.today)
    .first<{ consulted: number; fitted: number }>();
  const { consultation_fit_percent: fallback, enough_to_learn: enough } = horizon.assumptions;
  return learnedRate(row?.fitted ?? 0, row?.consulted ?? 0, fallback, enough);
}

/** The consultations booked in the horizon, as the first fits they are likely to become, spread by each city's mix. */
export async function pipelineLayer(db: D1Database, horizon: Horizon): Promise<{ layer: LayerMap; rate: number }> {
  const [rate, mix] = await Promise.all([fitRate(db, horizon), cityMix(db, horizon)]);
  const { results } = await db
    .prepare(
      `SELECT a.window_start, ${visitCity("a")} AS city
       FROM appointments a
       WHERE ${bookedAhead("a")} AND a.type = 'consultation'`,
    )
    .bind(horizon.today, lastDay(horizon))
    .all<{ window_start: string; city: string | null }>();
  const layer: LayerMap = new Map();
  for (const row of results) {
    const period = periodIn(horizon, addDays(dayOf(row.window_start), horizon.assumptions.consultation_to_fit_days));
    if (period === null) continue;
    for (const { code, share } of mix.get(row.city ?? "") ?? [])
      add(layer, keyOf(code, row.city, period), rate * share);
  }
  return { layer, rate };
}

type EventRow = { city: string | null; starts_on: string; ends_on: string; uplift_percent: number };

/** What the events ops keep lift a city's period by: each event overlapping it, in that city or every city. */
function upliftOf(events: readonly EventRow[], city: string | null, start: string, end: string): number {
  return events
    .filter((event) => (event.city === null || event.city === city) && event.starts_on < end && event.ends_on >= start)
    .reduce((lift, event) => lift * (1 + event.uplift_percent / 100), 1);
}

/** What each city used of each item over its last periods, as a period's worth in each period, lifted by events. */
export async function baselineLayer(db: D1Database, horizon: Horizon): Promise<LayerMap> {
  const { used, events } = await readAll(db, {
    used: read<{ code: string; city: string | null; used: number }>(
      db
        .prepare(
          `SELECT m.consumable_code AS code, t.city, SUM(-m.quantity) AS used
         FROM stock_movements m INDEXED BY stock_movements_used_by_day
         LEFT JOIN technicians t ON t.id = COALESCE(m.technician_id, m.place_id)
         WHERE m.reason = 'used' AND m.created_at >= ?1 GROUP BY 1, 2`,
        )
        .bind(addDays(horizon.today, -horizon.assumptions.baseline_periods * horizon.periodDays)),
    ),
    events: read<EventRow>(
      db
        .prepare(
          `SELECT city, starts_on, ends_on, uplift_percent FROM demand_events INDEXED BY demand_events_by_end
         WHERE deleted_at IS NULL AND ends_on >= ?1 AND starts_on < ?2`,
        )
        .bind(horizon.today, lastDay(horizon)),
    ),
  });
  const eventRows = events;
  const layer: LayerMap = new Map();
  for (const row of used) {
    if (row.used <= 0) continue;
    for (let period = 0; period < horizon.horizonPeriods; period += 1) {
      const start = addDays(horizon.today, period * horizon.periodDays);
      const lift = upliftOf(eventRows, row.city, start, addDays(start, horizon.periodDays));
      add(layer, keyOf(row.code, row.city, period), (row.used / horizon.assumptions.baseline_periods) * lift);
    }
  }
  return layer;
}
