// The events calendar (src/domain/field/demand-events.ts, src/routes/ops/demand-events.ts;
// docs/decisions/0182-the-events-calendar.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: an event is added in a served city or every city and listed until it ends; one ending before it
// starts, or set in a city we do not serve, is refused naming the box; one taken off is gone from the list but kept;
// and the forecast names each item it expects.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOW, markDatabase, request } from "../helpers.ts";
import { working, type Working } from "../job-fixtures.ts";

interface Calendar {
  events: { id: string; name: string; city: string | null; starts_on: string; uplift_percent: number }[];
  cities: string[];
}

let job: Working;

const event = (overrides: Record<string, unknown> = {}) => ({
  name: "Wedding season",
  city: "Gurgaon",
  starts_on: "2026-11-01",
  ends_on: "2026-11-30",
  uplift_percent: 25,
  ...overrides,
});

beforeEach(async () => {
  await markDatabase();
  job = await working();
});

describe("the events calendar", () => {
  it("lists events still to end, refuses a backwards one or an unknown city, and takes one off", async () => {
    const empty = await (await request(job.ops, "/api/demand-events")).json<Calendar>();
    expect(empty.events).toEqual([]);
    expect(empty.cities).toContain("Gurgaon");

    expect((await job.opsPost("/api/demand-events", event())).status).toBe(200);
    const added = await job.opsPost(
      "/api/demand-events",
      event({ name: "Diwali", city: null, starts_on: "2026-11-08", ends_on: "2026-11-12", uplift_percent: -10 }),
    );
    const calendar = await added.json<Calendar>();
    expect(calendar.events.map((each) => [each.name, each.city, each.uplift_percent])).toEqual([
      ["Wedding season", "Gurgaon", 25],
      ["Diwali", null, -10],
    ]);

    const backwards = await job.opsPost("/api/demand-events", event({ ends_on: "2026-10-01" }));
    expect(backwards.status).toBe(400);
    expect(await backwards.json()).toMatchObject({ error: { code: "invalid_request", fields: ["ends_on"] } });
    const elsewhere = await job.opsPost("/api/demand-events", event({ city: "Atlantis" }));
    expect(await elsewhere.json()).toMatchObject({ error: { fields: ["city"] } });

    await env.DB.prepare(
      `INSERT INTO demand_events (id, name, city, starts_on, ends_on, uplift_percent, created_by, created_at)
       VALUES ('ended', 'Monsoon sale', NULL, '2026-07-01', '2026-07-31', 15, 'ops@localhost', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const wedding = calendar.events[0]?.id ?? "";
    const removed = await job.opsPost(`/api/demand-events/${wedding}/remove`, {});
    expect((await removed.json<Calendar>()).events.map((each) => each.name)).toEqual(["Diwali"]);
    expect((await job.opsPost(`/api/demand-events/${wedding}/remove`, {})).status).toBe(404);
    const kept = await env.DB.prepare("SELECT COUNT(*) AS n FROM demand_events WHERE deleted_at IS NOT NULL").first();
    expect(kept).toEqual({ n: 1 });
    const actions = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action LIKE 'demand_event.%' ORDER BY at, action",
    ).all();
    expect(actions.results.map((row) => row.action)).toEqual([
      "demand_event.add",
      "demand_event.add",
      "demand_event.remove",
    ]);
  });

  it("names each item the forecast expects", async () => {
    await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forecast_runs (id, run_on, period_days, horizon_periods, due_rate, fit_rate, ran_at)
         VALUES ('run-1', '2026-09-21', 7, 12, 0.8, 0.5, ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO forecast_lines (run_id, consumable_code, city, period, booked, due, pipeline, baseline, expected,
           high)
         VALUES ('run-1', 'solvent', 'Gurgaon', 0, 10, 0, 0, 2, 12, 15)`,
      ),
    ]);
    const forecast = await (
      await request(job.ops, "/api/stock/forecast?city=Gurgaon")
    ).json<{
      lines: { name: string; expected: number }[];
    }>();
    expect(forecast.lines).toMatchObject([{ name: "Solvent", expected: 12 }]);
  });
});
