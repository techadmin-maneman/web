// The supply plan (src/domain/field/supply-plan.ts, supply-plan-lines.ts, src/routes/ops/supply-plan.ts;
// docs/decisions/0180-supply-plan.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a city short of an item borrows first from a city with spare, then from the warehouse, and what is
// still short is ordered from the supplier in whole packs and at least its minimum; an approval at a quantity sends the
// transfer or drafts the order, once; a rejection keeps why; and a new draft replaces only the proposals.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { draftPlan } from "../../../src/domain/field/supply-plan.ts";
import { NOW, markDatabase, request } from "../helpers.ts";
import { working, type Working } from "../job-fixtures.ts";

interface Plan {
  lines: {
    id: string;
    kind: string;
    from: string | null;
    to: string | null;
    supplier: string | null;
    proposed: number;
    state: string;
    po_number: number | null;
  }[];
}

let job: Working;

const plan = async () => (await request(job.ops, "/api/supply-plan")).json<Plan>();

beforeEach(async () => {
  await markDatabase();
  job = await working();
  const at = NOW.toISOString();
  await env.DB.prepare(
    `INSERT INTO stock_places (id, kind, name, parent_id, zone, city, created_by, created_at) VALUES
       ('delhi-room', 'stockroom', 'Delhi stockroom', 'central', NULL, 'Delhi', 'test', ?1),
       ('gurgaon-room', 'stockroom', 'Gurgaon stockroom', 'central', NULL, 'Gurgaon', 'test', ?1)`,
  )
    .bind(at)
    .run();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  const added = await job.opsPost("/api/suppliers", {
    name: "Kesh Supplies",
    gstin: null,
    country: "IN",
    currency: "INR",
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    payment_terms_days: 30,
    warranty_days: 90,
  });
  const supplier = (await added.json<{ suppliers: { id: string }[] }>()).suppliers[0]?.id ?? "";
  await job.opsPost(`/api/suppliers/${supplier}/items`, {
    consumable_code: "solvent",
    their_code: null,
    unit_price: 4500,
    pack_size: 12,
    minimum_order: 24,
    lead_time_days: 0,
  });
  await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: "delhi-room", counted: 8 });
  await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: "central", counted: 5 });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forecast_runs (id, run_on, period_days, horizon_periods, due_rate, fit_rate, ran_at)
       VALUES ('run-1', '2026-09-21', 7, 12, 0.8, 0.5, ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO forecast_lines (run_id, consumable_code, city, period, booked, due, pipeline, baseline, expected, high)
       VALUES ('run-1', 'solvent', 'Gurgaon', 0, 10, 0, 0, 0, 10, 15),
              ('run-1', 'solvent', 'Delhi', 0, 2, 0, 0, 0, 2, 3)`,
    ),
  ]);
});

describe("the supply plan", () => {
  it("lends from a city with spare, then sends from the warehouse, then orders the rest in whole packs", async () => {
    expect(await draftPlan(env.DB, "run-1", NOW, 7)).toBe(3);
    expect((await plan()).lines).toEqual([
      expect.objectContaining({ kind: "transfer", from: "Delhi stockroom", to: "Gurgaon stockroom", proposed: 5 }),
      expect.objectContaining({ kind: "transfer", from: "National warehouse", to: "Gurgaon stockroom", proposed: 5 }),
      expect.objectContaining({ kind: "order", supplier: "Kesh Supplies", proposed: 24 }),
    ]);
  });

  it("sends an approved loan and drafts an approved order, once each, and keeps why a line was rejected", async () => {
    await draftPlan(env.DB, "run-1", NOW, 7);
    const [loan, send, order] = (await plan()).lines;
    const approved = await job.opsPost(`/api/supply-plan/lines/${loan?.id ?? ""}/approve`, { quantity: 4 });
    expect(approved.status).toBe(200);
    const moving = await env.DB.prepare("SELECT from_place, quantity, state FROM stock_transfers").all();
    expect(moving.results).toEqual([{ from_place: "delhi-room", quantity: 4, state: "in_transit" }]);
    expect((await job.opsPost(`/api/supply-plan/lines/${loan?.id ?? ""}/approve`, { quantity: 4 })).status).toBe(409);

    const ordered = await (
      await job.opsPost(`/api/supply-plan/lines/${order?.id ?? ""}/approve`, { quantity: 24 })
    ).json<Plan>();
    expect(ordered.lines.find((line) => line.id === order?.id)).toMatchObject({ state: "approved", po_number: 1 });
    await job.opsPost(`/api/supply-plan/lines/${send?.id ?? ""}/reject`, {
      reason: "The warehouse keeps it for Noida.",
    });

    await draftPlan(env.DB, "run-1", NOW, 7);
    const states = (await plan()).lines.map((line) => line.state).sort();
    expect(states.filter((state) => state !== "proposed")).toEqual(["approved", "approved", "rejected"]);
  });

  it("gives an approval back where its move is refused, as an order whose supplier was retired since", async () => {
    await draftPlan(env.DB, "run-1", NOW, 7);
    const order = (await plan()).lines.find((line) => line.kind === "order");
    await env.DB.prepare("UPDATE suppliers SET retired_at = ?1").bind(NOW.toISOString()).run();
    const refused = await job.opsPost(`/api/supply-plan/lines/${order?.id ?? ""}/approve`, { quantity: 24 });
    expect(refused.status).toBe(400);
    expect((await plan()).lines.find((line) => line.id === order?.id)?.state).toBe("proposed");
  });

  it("is drafted again on request from the latest forecast, and refused before any forecast has run", async () => {
    const drafted = await job.opsPost("/api/supply-plan/draft");
    expect((await drafted.json<Plan>()).lines).toHaveLength(3);
    const forecast = await (
      await request(job.ops, "/api/stock/forecast")
    ).json<{
      run: { run_on: string } | null;
      lines: { city: string }[];
    }>();
    expect(forecast.run?.run_on).toBe("2026-09-21");
    expect(forecast.lines.map((line) => line.city).sort()).toEqual(["Delhi", "Gurgaon"]);

    await env.DB.batch([env.DB.prepare("DELETE FROM forecast_lines"), env.DB.prepare("DELETE FROM forecast_runs")]);
    expect((await job.opsPost("/api/supply-plan/draft")).status).toBe(409);
    const none = await (
      await request(job.ops, "/api/stock/forecast?city=Gurgaon")
    ).json<{ run: unknown; lines: unknown[] }>();
    expect(none).toEqual({ run: null, lines: [] });
  });
});
