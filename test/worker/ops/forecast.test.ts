// The demand forecast (src/domain/field/forecast.ts, src/domain/field/forecast-layers.ts, src/routes/ops/stock-forecast.ts;
// docs/decisions/0179-demand-forecast.md). NOW is Monday 21 September 2026, 12 noon in India; the periods here are
// seven days, four of them.
//
// What these hold: a fit booked counts its client's hair system where it falls; a piece falling due counts at the rate
// due clients book; a consultation counts as the first fit it may become, two weeks on, spread by its city's mix; each
// city's use of an item over its last periods is a period's baseline, lifted by an event ops keep; the forecast runs
// once a planning period, and the console reads its latest run with what each layer gave.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runForecastIfDue } from "../../../src/domain/field/forecast.ts";
import { NOW, markDatabase, request } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";
import { FORECAST_ASSUMPTIONS } from "../../../src/policy/forecast.ts";

const SETTINGS = { planningPeriodDays: 7, planningHorizonPeriods: 4, forecastAssumptions: FORECAST_ASSUMPTIONS };
const FITTED = "77777777-7777-4777-8777-777777777771";
const DUE = "77777777-7777-4777-8777-777777777772";

let job: Working;
let code: string;

interface Forecast {
  run: { run_on: string; due_rate: number; fit_rate: number } | null;
  lines: {
    consumable_code: string;
    city: string;
    period: number;
    booked: number;
    due: number;
    pipeline: number;
    baseline: number;
    expected: number;
  }[];
}

const forecast = async () => (await request(job.ops, "/api/stock/forecast?city=Gurgaon")).json<Forecast>();
const lineOf = (book: Forecast, of: string, period: number) =>
  book.lines.find((line) => line.consumable_code === of && line.period === period);
const ago = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const ahead = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

/** A visit with Imran, in Gurgaon, `days` on. */
function visit(id: string, person: string, type: string, days: number) {
  return env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
       service_city, synced_at)
     VALUES (?1, ?1, ?2, ?3, 'essential', 'scheduled', ?4, ?4, ?5, 'Gurgaon', ?6)`,
  ).bind(id, person, type, ahead(days), IMRAN, NOW.toISOString());
}

/** What Imran's kit used of an item `days` ago, on the consumables step of an earlier visit. */
function used(of: string, quantity: number, days: number) {
  const event = crypto.randomUUID();
  return [
    env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         fsm_write_state, updated_at)
       VALUES (?1, 'fitted-before', ?1, ?2, 'consumables', '{}', ?3, ?3, 'written', ?3)`,
    ).bind(event, IMRAN, ago(days)),
    env.DB.prepare(
      `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, job_event_id,
       appointment_id, actor_kind, actor, created_at)
     VALUES (?1, ?2, 'kit', ?3, ?4, 'used', ?6, 'fitted-before', 'technician', ?3, ?5)`,
    ).bind(crypto.randomUUID(), of, IMRAN, -quantity, ago(days), event),
  ];
}

beforeEach(async () => {
  await markDatabase();
  job = await working("first_fit");
  await env.DB.batch([
    env.DB.prepare("UPDATE technicians SET city = 'Gurgaon'"),
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
    ).bind(NOW.toISOString()),
  ]);
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  const added = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  code = (await added.json<{ code: string }>()).code;
  const people = [FITTED, DUE].map((person, index) =>
    env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'A client')").bind(
      person,
      NOW.toISOString(),
      `+91981007777${String(index)}`,
    ),
  );
  const profiles = [FITTED, DUE].map((person) =>
    env.DB.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
         grey_percent, density_percent)
       VALUES (?1, ?2, 'ops@localhost', ?3, 'essential', 8, 10, '1B', 20, 100)`,
    ).bind(crypto.randomUUID(), person, NOW.toISOString()),
  );
  await env.DB.batch([
    ...people,
    ...profiles,
    visit("fit-1", FITTED, "first_fit", 3),
    visit("fitted-before", DUE, "first_fit", -300),
    env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, appointment_id, replacement_due_at, synced_at)
       VALUES ('piece-1', 'piece-1', ?1, 'MM-ESS-0000001-B', ?2, 'fitted-before', ?3, ?4)`,
    ).bind(DUE, ago(300), ahead(10).slice(0, 10), NOW.toISOString()),
    visit("consult-1", FITTED, "consultation", 5),
    ...used(code, 1, 30),
    ...used("solvent", 16, 20),
  ]);
});

describe("the demand forecast", () => {
  it("adds up what is booked, due and in the pipeline, and each city's history, saying what each gave", async () => {
    expect(await runForecastIfDue(env.DB, NOW, SETTINGS)).not.toBeNull();
    const book = await forecast();
    expect(book.run).toMatchObject({ run_on: "2026-09-21", due_rate: 0.8, fit_rate: 0.5 });
    expect(lineOf(book, code, 0)).toMatchObject({ booked: 1, expected: 1 });
    expect(lineOf(book, code, 1)).toMatchObject({ due: 0.8, expected: 0.8 });
    expect(lineOf(book, code, 2)).toMatchObject({ pipeline: 0.5, expected: 0.5 });
    expect(lineOf(book, "solvent", 3)).toMatchObject({ baseline: 2, expected: 2 });
  });

  it("lifts the baseline by an event ops keep, and runs once a planning period", async () => {
    await env.DB.prepare(
      `INSERT INTO demand_events (id, name, city, starts_on, ends_on, uplift_percent, created_by, created_at)
       VALUES ('ev-1', 'Wedding season', 'Gurgaon', '2026-10-05', '2026-10-11', 50, 'ops@localhost', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    await runForecastIfDue(env.DB, NOW, SETTINGS);
    const book = await forecast();
    expect(lineOf(book, "solvent", 2)?.baseline).toBe(3);
    expect(lineOf(book, "solvent", 1)?.baseline).toBe(2);

    expect(await runForecastIfDue(env.DB, new Date(ahead(6)), SETTINGS)).toBeNull();
    expect(await runForecastIfDue(env.DB, new Date(ahead(7)), SETTINGS)).not.toBeNull();
  });
});
