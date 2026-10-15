// Tomorrow's kits (src/domain/inventory/kit-check.ts; docs/decisions/0181-tomorrows-kits.md). NOW is Monday 21 September
// 2026, 12 noon in India; the evening's check runs from 5 pm.
//
// What these hold: from the evening, each kit is checked against its visits tomorrow, a service's consumables by its
// expected use and a fit's hair system made to its client; what it is short of is proposed as a top-up from its
// city's stockroom, ops are told once, and an approved top-up waits for the technician's scan; a one visit whose client's
// head is not yet measured adds the city's one-visit range; the supply plan's own redraft leaves the evening's top-ups be.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { checkTomorrowsKits } from "../../../src/domain/inventory/kit-check.ts";
import { draftPlan } from "../../../src/domain/purchasing/supply-plan.ts";
import { NOW, markDatabase, request } from "../helpers.ts";
import { IMRAN, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";
import { KIT_CHECK } from "../../../src/policy/kit-check.ts";

const CLIENT = "88888888-8888-4888-8888-888888888881";
const EVENING = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
const TOMORROW = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();

let job: Working;
let code: string;
let told: string[];

const alertOnce = (alert: { key: string; message: string }) => {
  told.push(alert.message);
  return Promise.resolve();
};

beforeEach(async () => {
  await markDatabase();
  told = [];
  job = await working();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE technicians SET city = 'Gurgaon'"),
    env.DB.prepare(
      `INSERT INTO stock_places (id, kind, name, parent_id, zone, city, created_by, created_at)
       VALUES ('gurgaon-room', 'stockroom', 'Gurgaon stockroom', 'central', NULL, 'Gurgaon', 'test', ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
    ).bind(at),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810088881', 'A client')",
    ).bind(CLIENT, at),
    env.DB.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
         grey_percent, density_percent)
       VALUES ('hp-1', ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 20, 100)`,
    ).bind(CLIENT, at),
  ]);
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await job.opsPost("/api/service-usage", {
    visit_type: "service",
    tier: "standard",
    items: [{ code: "solvent", quantity: 10 }],
  });
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
  await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: IMRAN, counted: 4 });
  await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: "gurgaon-room", counted: 50 });
  await env.DB.batch(
    [
      ["service-tomorrow", PERSON, "service", "standard"],
      ["fit-tomorrow", CLIENT, "first_fit", "essential"],
    ].map(([id, person, type, tier]) =>
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
           service_city, synced_at)
         VALUES (?1, ?1, ?2, ?3, ?4, 'scheduled', ?5, ?5, ?6, 'Gurgaon', ?7)`,
      ).bind(id, person, type, tier, TOMORROW, IMRAN, at),
    ),
  );
});

describe("tomorrow's kits", () => {
  it("are checked from the evening, each shortfall proposed as a top-up from the city's stockroom, and ops told", async () => {
    expect(await checkTomorrowsKits(env.DB, NOW, alertOnce, KIT_CHECK)).toBe(0);
    expect(await checkTomorrowsKits(env.DB, EVENING, alertOnce, KIT_CHECK)).toBe(1);
    expect(await checkTomorrowsKits(env.DB, EVENING, alertOnce, KIT_CHECK)).toBe(1);
    const lines = await env.DB.prepare(
      "SELECT consumable_code, from_place, to_place, proposed FROM plan_lines ORDER BY consumable_code",
    ).all();
    expect(lines.results).toEqual(
      [
        { consumable_code: code, from_place: "gurgaon-room", to_place: IMRAN, proposed: 1 },
        { consumable_code: "solvent", from_place: "gurgaon-room", to_place: IMRAN, proposed: 6 },
      ].sort((a, b) => a.consumable_code.localeCompare(b.consumable_code)),
    );
    // The chat is told the kit by its technician's ID; the console names them.
    expect(told[0]).toContain(`technician ${IMRAN}'s kit is short for tomorrow of `);
    expect(told[0]).not.toContain("Imran");
    // The stockroom holds solvent enough, and none of the client's hair system: that gap is told as one.
    expect(told[0]).toContain(`Gurgaon stockroom can't cover ${code}: order or move one.`);
    expect(told[0]).not.toContain("cover solvent");
  });

  it("carries the city's one-visit range for a one visit whose client's head is not yet measured", async () => {
    const at = NOW.toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forecast_runs (id, run_on, period_days, horizon_periods, due_rate, fit_rate, ran_at)
         VALUES ('run-1', '2026-09-21', 7, 12, 0.8, 0.5, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO forecast_lines (run_id, consumable_code, city, period, booked, due, pipeline, baseline, expected,
           high) VALUES ('run-1', ?1, 'Gurgaon', 0, 0, 1, 1, 0, 2, 4.3), ('run-1', 'solvent', 'Gurgaon', 0, 9, 0, 0, 0, 9, 14)`,
      ).bind(code),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
           service_city, synced_at, one_visit)
         VALUES ('one-visit', 'one-visit', ?4, 'first_fit', NULL, 'scheduled', ?1, ?1, ?2, 'Gurgaon', ?3, 'booked')`,
      ).bind(TOMORROW, IMRAN, at, PERSON),
    ]);
    await checkTomorrowsKits(env.DB, EVENING, alertOnce, KIT_CHECK);
    const pieces = await env.DB.prepare("SELECT proposed FROM plan_lines WHERE consumable_code = ?1")
      .bind(code)
      .first();
    expect(pieces).toEqual({ proposed: 2 });
  });

  it("tops each kit up for the week on the evening ops set: the week's consumables and the kit level", async () => {
    await job.opsPost("/api/consumables/solvent", { reorder_kit: 5 });
    const later = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(NOW.getTime() + 9 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.batch(
      [
        ["service-later", later],
        ["service-past-the-week", past],
      ].map(([id, at]) =>
        env.DB.prepare(
          `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
             service_city, synced_at)
           VALUES (?1, ?1, ?4, 'service', 'standard', 'scheduled', ?2, ?2, ?3, 'Gurgaon', ?2)`,
        ).bind(id, at, IMRAN, PERSON),
      ),
    );
    // Monday's evening: the week's top-up day.
    await checkTomorrowsKits(env.DB, EVENING, alertOnce, { ...KIT_CHECK, top_up_weekday: 1 });
    const lines = await env.DB.prepare(
      `SELECT to_place, consumable_code, proposed, usable, need, safety FROM plan_lines
       ORDER BY to_place = ?1 DESC, consumable_code = 'solvent'`,
    )
      .bind(IMRAN)
      .all();
    // Two visits in the week at 10 ml each and a level of 5, against the 4 ml the kit holds; the hair system is
    // tomorrow's. A kit with no visits is still brought up to its level.
    expect(lines.results).toEqual([
      { to_place: IMRAN, consumable_code: code, proposed: 1, usable: 0, need: 1, safety: 0 },
      { to_place: IMRAN, consumable_code: "solvent", proposed: 21, usable: 4, need: 20, safety: 5 },
      { to_place: SAMEER, consumable_code: "solvent", proposed: 5, usable: 0, need: 0, safety: 5 },
    ]);
    expect(told).toContainEqual(expect.stringContaining(`technician ${IMRAN}'s kit is short for the week of `));
  });

  it("sends an approved top-up to wait for the technician's scan, and outlasts the plan's own redraft", async () => {
    await checkTomorrowsKits(env.DB, EVENING, alertOnce, KIT_CHECK);
    const solvent = await env.DB.prepare("SELECT id FROM plan_lines WHERE consumable_code = 'solvent'").first<string>(
      "id",
    );
    expect((await job.opsPost(`/api/supply-plan/lines/${solvent ?? ""}/approve`, { quantity: 6 })).status).toBe(200);
    const moving = await env.DB.prepare("SELECT to_place, quantity, state FROM stock_transfers").all();
    expect(moving.results).toEqual([{ to_place: IMRAN, quantity: 6, state: "in_transit" }]);
    // The next evening hour counts what is on its way as held, and proposes no second top-up.
    await checkTomorrowsKits(env.DB, EVENING, alertOnce, KIT_CHECK);
    const solventLines = await env.DB.prepare("SELECT state FROM plan_lines WHERE consumable_code = 'solvent'").all();
    expect(solventLines.results).toEqual([{ state: "approved" }]);

    await env.DB.prepare(
      `INSERT INTO forecast_runs (id, run_on, period_days, horizon_periods, due_rate, fit_rate, ran_at)
       VALUES ('run-1', '2026-09-21', 7, 12, 0.8, 0.5, ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    await draftPlan(env.DB, "run-1", EVENING, 7);
    const page = await (await request(job.ops, "/api/supply-plan")).json<{ lines: { state: string }[] }>();
    expect(page.lines.map((line) => line.state).sort()).toEqual(["approved", "proposed"]);
  });
});
