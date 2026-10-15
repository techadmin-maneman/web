// Usage against expected, and shrinkage (src/domain/inventory/stock-usage.ts, src/routes/ops/stock-usage.ts;
// docs/decisions/0186-usage-and-shrinkage.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a technician's consumables are set beside what their visits were expected to use, valued at cost,
// and one well over across enough visits is flagged; a place's losses, counted short or written off, are a share of
// what left it, and a kit that keeps needing write-offs is flagged.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOW, markDatabase, request } from "../helpers.ts";
import { IMRAN, JOB, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";

interface Usage {
  technicians: { technician_id: string; visits: number; over_percent: number | null; flagged: boolean }[];
  places: {
    place_id: string;
    lost_value: number;
    write_offs: number;
    shrinkage_percent: number | null;
    flagged: boolean;
  }[];
}

let job: Working;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

/** Visits done by a technician, each a service of the standard tier. */
const visits = (technician: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
         service_city, synced_at)
       VALUES (?1, ?1, ?4, 'service', NULL, 'completed', ?2, ?2, ?3, 'Gurgaon', ?2)`,
    ).bind(`${technician}-${String(index)}`, daysAgo(index + 1), technician, PERSON),
  );

/** What a technician's consumables step took from their kit. */
const used = (id: string, technician: string, quantity: number) => [
  env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at, updated_at)
     VALUES (?1, ?2, ?1, ?3, 'consumables', '{}', ?4, ?4, ?4)`,
  ).bind(id, JOB, technician, daysAgo(2)),
  env.DB.prepare(
    `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, appointment_id,
       job_event_id, actor_kind, actor, created_at)
     VALUES (?1, 'solvent', 'kit', ?2, ?3, 'used', ?4, ?1, 'technician', ?2, ?5)`,
  ).bind(id, technician, -quantity, JOB, daysAgo(2)),
];

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await job.opsPost("/api/service-usage", {
    visit_type: "service",
    tier: "standard",
    items: [{ code: "solvent", quantity: 10 }],
  });
  for (const kit of [IMRAN, SAMEER]) {
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: kit, counted: 500 });
  }
  await env.DB.batch([
    ...visits(IMRAN, 6),
    ...visits(SAMEER, 2),
    ...used("u-1", IMRAN, 90),
    ...used("u-2", SAMEER, 20),
  ]);
});

describe("usage and shrinkage", () => {
  it("set each technician's use beside expected, flagging one well over across enough visits", async () => {
    const usage = await (await request(job.ops, "/api/stock/usage")).json<Usage>();
    expect(usage.technicians.map((each) => [each.technician_id, each.visits, each.over_percent, each.flagged])).toEqual(
      [
        [IMRAN, 6, 50, true],
        [SAMEER, 2, 0, false],
      ],
    );
  });

  it("give each place's losses as a share of what left it, flagging a kit that keeps needing write-offs", async () => {
    for (const note of ["Spilt", "Spilt again", "Cap left off"]) {
      await job.opsPost("/api/stock/write-offs", { consumable_code: "solvent", place_id: IMRAN, quantity: 10, note });
    }
    const usage = await (await request(job.ops, "/api/stock/usage")).json<Usage>();
    const kit = usage.places.find((place) => place.place_id === IMRAN);
    expect(kit).toMatchObject({ lost_value: 1500, write_offs: 3, shrinkage_percent: 25, flagged: true });
    expect(usage.places.find((place) => place.place_id === SAMEER)).toMatchObject({ lost_value: 0, flagged: false });
  });

  it("gives the share of a place's counted lines right the first time", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO count_tasks (id, place_id, count_class, due_on, state, raised_at, counted_by, counted_at, done_at)
         VALUES ('ct-1', ?1, 'quarterly', '2026-09-20', 'done', ?2, 'ops@localhost', ?2, ?2)`,
      ).bind(IMRAN, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO count_lines (task_id, consumable_code, held, counted, state)
         VALUES ('ct-1', 'solvent', 500, 500, 'settled')`,
      ),
    ]);
    const usage = await (
      await request(job.ops, "/api/stock/usage")
    ).json<{
      places: { place_id: string; count_accuracy_percent: number | null }[];
    }>();
    expect(usage.places.find((place) => place.place_id === IMRAN)?.count_accuracy_percent).toBe(100);
  });
});
