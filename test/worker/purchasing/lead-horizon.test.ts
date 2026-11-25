// A supplier's lead time against the forecast's reach (src/domain/purchasing/lead-horizon.ts;
// docs/decisions/0319-rules-that-hold-together.md): the supply plan names each item whose cheapest supplier's lead time,
// and one period, runs past the forecast, and Settings refuses a horizon or a period that would leave one past it.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { POST } from "../ops/ops-settings-fixtures.ts";

let ops: App;

const post = (path: string, body: unknown) =>
  request(ops, path, { method: "POST", headers: POST, body: JSON.stringify(body) });

interface Plan {
  past_horizon: { code: string; name: string; lead_time_days: number }[];
  forecast_days: number;
}

const plan = async (): Promise<Plan> => (await request(ops, "/api/supply-plan")).json<Plan>();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  // A week's periods, eight of them: the forecast looks 56 days ahead.
  expect((await post("/api/settings/planning_period_days", { value: 7 })).status).toBe(200);
  expect((await post("/api/settings/planning_horizon_periods", { value: 8 })).status).toBe(200);
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO consumables (code, name, unit, unit_cost, reorder_kit, created_at, updated_at)
       VALUES ('lace', 'Lace base', 'piece', 1, 0, ?1, ?1), ('tape', 'Tape', 'roll', 1, 0, ?1, ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO suppliers (id, name, country, currency, payment_terms_days, warranty_days, created_at, updated_at,
         retired_at)
       VALUES ('sup-cheap', 'Cheap', 'CN', 'USD', 30, 90, ?1, ?1, NULL),
              ('sup-dear', 'Dear', 'IN', 'INR', 30, 90, ?1, ?1, NULL),
              ('sup-gone', 'Gone', 'CN', 'USD', 30, 90, ?1, ?1, ?1)`,
    ).bind(at),
    // Lace base's cheapest supplier takes 70 days; a dearer one takes 5, and a retired one, cheaper, 300.
    // Tape's takes 14.
    env.DB.prepare(
      `INSERT INTO supplier_items (supplier_id, consumable_code, unit_price, pack_size, minimum_order, lead_time_days,
         updated_at)
       VALUES ('sup-cheap', 'lace', 100, 1, 1, 70, ?1), ('sup-dear', 'lace', 200, 1, 1, 5, ?1),
              ('sup-gone', 'lace', 50, 1, 1, 300, ?1), ('sup-cheap', 'tape', 100, 1, 1, 14, ?1)`,
    ).bind(at),
  ]);
});

describe("a lead time past the forecast", () => {
  it("is named on the supply plan, by the cheapest live supplier's lead time", async () => {
    expect(await plan()).toMatchObject({
      forecast_days: 56,
      past_horizon: [{ code: "lace", name: "Lace base", lead_time_days: 70 }],
    });
  });

  it("refuses a horizon or a period that would leave one past the forecast, and takes one that reaches past it", async () => {
    // 70 days and a week take eleven weekly periods.
    const short = await post("/api/settings/planning_horizon_periods", { value: 10 });
    expect(short.status).toBe(422);
    expect(await short.json()).toMatchObject({
      error: { code: "figures_conflict", fields: ["planning_horizon_periods", "supplier_items.lead_time_days"] },
    });
    expect((await post("/api/settings/planning_horizon_periods", { value: 11 })).status).toBe(200);
    expect((await plan()).past_horizon).toEqual([]);
    // Three-day periods would need 25 of them.
    const narrow = await post("/api/settings/planning_period_days", { value: 3 });
    expect(narrow.status).toBe(422);
    expect(await narrow.json()).toMatchObject({
      error: { code: "figures_conflict", fields: ["planning_period_days", "supplier_items.lead_time_days"] },
    });
  });
});
