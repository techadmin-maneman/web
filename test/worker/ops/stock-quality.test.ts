// Failure rates and value at risk (src/domain/field/stock-quality.ts, src/routes/ops/stock-quality.ts;
// docs/decisions/0188-failure-rates-and-value-at-risk.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: the pieces fitted from labelled stock are counted with those that failed, by stock code, lot and
// the technician who fitted them; and what a place will not use of a lot before it expires, at its pace over the last
// four weeks, is valued at cost, the expired written off and the rest moved to where it goes fastest.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, PERSON, working, type Working } from "../job-fixtures.ts";

let job: Working;

beforeEach(async () => {
  await markDatabase();
  job = await working("first_fit");
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
});

describe("failure rates", () => {
  it("count the pieces fitted from labelled stock, and those that failed, by code, lot and technician", async () => {
    const added = await job.opsPost("/api/hair-systems", {
      product: "essential",
      base_width_in: 8,
      base_length_in: 10,
      colour: "1B",
      grey_percent: 20,
      density_percent: 100,
      unit_cost: 1_200_000,
    });
    const code = (await added.json<{ code: string }>()).code;
    await job.opsPost("/api/stock/deliveries", {
      consumable_code: code,
      quantity: 3,
      lot_code: "L1",
      expires_on: "2028-03-31",
    });
    const labels = await env.DB.prepare("SELECT code FROM stock_units ORDER BY code LIMIT 2").all<{ code: string }>();
    await env.DB.batch(
      labels.results.flatMap((unit, index) => [
        env.DB.prepare("UPDATE stock_units SET state = 'fitted', place = NULL WHERE code = ?1").bind(unit.code),
        env.DB.prepare(
          `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, appointment_id, failed_at,
             synced_at)
           VALUES (?1, ?1, ?2, ?3, '2026-08-01', '2027-02-01', ?4, ?5, ?6)`,
        ).bind(`piece-${String(index)}`, PERSON, unit.code, JOB, index === 0 ? "2026-09-01" : null, NOW.toISOString()),
      ]),
    );
    const rates = await (
      await request(job.ops, "/api/quality/failures")
    ).json<{
      by_code: { fitted: number; failed: number; rate_percent: number | null }[];
      by_lot: { name: string }[];
      by_supplier: unknown[];
      by_technician: { name: string; fitted: number; failed: number }[];
    }>();
    expect(rates.by_code).toMatchObject([{ fitted: 2, failed: 1, rate_percent: 50 }]);
    expect(rates.by_lot[0]?.name).toContain("L1");
    expect(rates.by_supplier).toEqual([]);
    expect(rates.by_technician).toMatchObject([{ name: "Imran Qureshi", fitted: 2, failed: 1 }]);
  });
});

describe("value at risk", () => {
  it("values what a place will not use before each lot expires, writing off the expired and moving the rest", async () => {
    await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
    await job.opsPost("/api/stock/deliveries", {
      consumable_code: "solvent",
      quantity: 100,
      lot_code: "SOON",
      expires_on: "2026-10-01",
    });
    await job.opsPost("/api/stock/transfers", { consumable_code: "solvent", quantity: 28, from: "central", to: IMRAN });
    await job.opsPost("/api/stock/deliveries", {
      consumable_code: "solvent",
      quantity: 5,
      lot_code: "OLD",
      expires_on: "2026-10-30",
    });
    await env.DB.batch([
      env.DB.prepare("UPDATE stock_lots SET expires_on = '2026-09-01' WHERE lot_code = 'OLD'"),
      env.DB.prepare(
        `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at, updated_at)
         VALUES ('used-1', ?1, 'used-1', ?2, 'consumables', '{}', ?3, ?3, ?3)`,
      ).bind(JOB, IMRAN, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason, appointment_id,
           job_event_id, actor_kind, actor, created_at)
         VALUES ('used-1', 'solvent', 'kit', ?2, -30, 'used', ?1, 'used-1', 'technician', ?2, ?3)`,
      ).bind(JOB, IMRAN, NOW.toISOString()),
    ]);
    const risk = await (
      await request(job.ops, "/api/stock/expiry-risk")
    ).json<{
      total_value: number;
      lots: {
        place_id: string;
        lot_code: string;
        quantity: number;
        value: number;
        suggestion: string;
        move_to: string | null;
      }[];
    }>();
    const central = risk.lots.filter((lot) => lot.place_id === "central");
    expect(central).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lot_code: "SOON",
          quantity: 62,
          value: 3100,
          suggestion: "move",
          move_to: "Imran Qureshi",
        }),
        expect.objectContaining({ lot_code: "OLD", quantity: 5, value: 250, suggestion: "write_off" }),
      ]),
    );
    expect(risk.total_value).toBeGreaterThanOrEqual(3350);
  });

  it("has the place that holds a lot use it first where no other place lets it go", async () => {
    await job.opsPost("/api/consumables", { name: "Tape", unit: "strip", unit_cost: 20 });
    await job.opsPost("/api/stock/deliveries", {
      consumable_code: "tape",
      quantity: 10,
      lot_code: "T1",
      expires_on: "2026-10-31",
    });
    const risk = await (
      await request(job.ops, "/api/stock/expiry-risk")
    ).json<{
      lots: { lot_code: string; quantity: number; value: number; suggestion: string; move_to: string | null }[];
    }>();
    expect(risk.lots).toEqual([
      expect.objectContaining({ lot_code: "T1", quantity: 10, value: 200, suggestion: "use_first", move_to: null }),
    ]);
  });
});
