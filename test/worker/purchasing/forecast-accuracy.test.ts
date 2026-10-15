// How right the forecast was (src/domain/purchasing/forecast-accuracy.ts; docs/decisions/0183-forecast-accuracy.md). NOW is
// Monday 21 September 2026, 12 noon in India.
//
// What these hold: a run is measured once its first period has passed, and once only; each line it expected sits
// beside what the kits used in that period, a code used that it never expected among them; and a city's accuracy reads
// back as its periods and each item, the furthest off first.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { measureLastForecast } from "../../../src/domain/purchasing/forecast-accuracy.ts";
import { NOW, markDatabase, request } from "../helpers.ts";
import { IMRAN, JOB, working, type Working } from "../job-fixtures.ts";

let job: Working;

/** What a job's consumables step took from Imran's kit, and when. */
const used = (id: string, code: string, quantity: number, at: string) => [
  env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at, updated_at)
     VALUES (?1, ?2, ?1, ?3, 'consumables', '{}', ?4, ?4, ?4)`,
  ).bind(id, JOB, IMRAN, at),
  env.DB.prepare(
    `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, appointment_id,
       job_event_id, actor_kind, actor, created_at)
     VALUES (?1, ?2, 'kit', ?3, ?4, 'used', ?5, ?1, 'technician', ?3, ?6)`,
  ).bind(id, code, IMRAN, -quantity, JOB, at),
];

beforeEach(async () => {
  await markDatabase();
  job = await working();
  for (const name of ["Solvent", "Gel", "Tape"]) {
    await job.opsPost("/api/consumables", { name, unit: "unit", unit_cost: 50 });
    await job.opsPost("/api/stock/counts", { consumable_code: name.toLowerCase(), place_id: IMRAN, counted: 50 });
  }
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE technicians SET city = 'Gurgaon'"),
    env.DB.prepare(
      `INSERT INTO forecast_runs (id, run_on, period_days, horizon_periods, due_rate, fit_rate, ran_at) VALUES
         ('last-week', '2026-09-14', 7, 12, 0.8, 0.5, ?1), ('this-week', '2026-09-21', 7, 12, 0.8, 0.5, ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO forecast_lines (run_id, consumable_code, city, period, booked, due, pipeline, baseline, expected,
         high) VALUES
         ('last-week', 'solvent', 'Gurgaon', 0, 10, 0, 0, 0, 10, 15),
         ('last-week', 'gel', 'Gurgaon', 0, 3, 0, 0, 0, 3, 6),
         ('last-week', 'solvent', 'Gurgaon', 1, 99, 0, 0, 0, 99, 115)`,
    ),
    ...used("m-1", "solvent", 12, "2026-09-16T06:00:00.000Z"),
    ...used("m-2", "tape", 2, "2026-09-18T06:00:00.000Z"),
    ...used("m-3", "solvent", 5, "2026-09-21T03:00:00.000Z"),
  ]);
});

describe("the forecast's accuracy", () => {
  it("measures a run once its first period has passed, once, a code it never expected among it", async () => {
    expect(await measureLastForecast(env.DB, NOW, "2026-09-21")).toBe("last-week");
    expect(await measureLastForecast(env.DB, NOW, "2026-09-21")).toBeNull();
    const rows = await env.DB.prepare(
      "SELECT consumable_code, expected, high, actual FROM forecast_accuracy ORDER BY consumable_code",
    ).all();
    expect(rows.results).toEqual([
      { consumable_code: "gel", expected: 3, high: 6, actual: 0 },
      { consumable_code: "solvent", expected: 10, high: 15, actual: 12 },
      { consumable_code: "tape", expected: 0, high: 0, actual: 2 },
    ]);
  });

  it("reads back as the city's periods and each item, the furthest off first", async () => {
    await measureLastForecast(env.DB, NOW, "2026-09-21");
    const answer = await (
      await request(job.ops, "/api/stock/forecast-accuracy?city=Gurgaon")
    ).json<{
      periods: unknown[];
      items: { name: string; error_percent: number | null }[];
    }>();
    expect(answer.periods).toEqual([
      {
        period_start: "2026-09-14",
        period_days: 7,
        expected: 13,
        actual: 14,
        error_percent: 50,
        bias_percent: -7,
        within_high_percent: 67,
      },
    ]);
    expect(answer.items.map((item) => [item.name, item.error_percent])).toEqual([
      ["Gel", null],
      ["Solvent", 17],
      ["Tape", 100],
    ]);
  });

  it("reads back nothing for a city never measured", async () => {
    await measureLastForecast(env.DB, NOW, "2026-09-21");
    const answer = await (await request(job.ops, "/api/stock/forecast-accuracy?city=Delhi")).json();
    expect(answer).toEqual({ periods: [], items: [] });
  });
});
