// Stock of consumables in each technician's kit and the central store, and a job's
// use of them (src/routes/ops/stock.ts, src/domain/field/job-use.ts;
// docs/decisions/0087-consumables-and-stock.md). NOW is Monday 21 September 2026,
// 12 noon in India.
//
// What these hold: what a place holds is the sum of its rows; a delivery, a
// transfer, a count and a write-off each write what they say, with the Access
// identity behind them; a job's use comes out of the technician's kit once,
// however often his step is replayed, and a later step corrects it by the
// difference; the old step by names is still taken; a count and a job's use,
// or two of a job's steps, landing together, each count once; and a kit that
// falls to its level raises one alert, which closes once it is stocked again.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { IMRAN, JOB, SAMEER, working, type Working } from "../job-fixtures.ts";
import { type Stock } from "./stock-fixtures.ts";

let job: Working;

const stock = async (): Promise<Stock> => (await request(job.ops, "/api/stock")).json<Stock>();

/** The places the console's Stock badge counts low, as the task board answers. */
const lowPlaces = async (): Promise<number> =>
  (await (await request(job.ops, "/api/tasks")).json<{ low_stock_places: number }>()).low_stock_places;

/** What a place holds of a consumable, as the Stock screen reads it. */
async function held(code: string, place: string | null): Promise<{ quantity: number; low: boolean }> {
  const holding = (await stock()).holdings.find(
    (each) => each.consumable_code === code && each.technician_id === place,
  );
  return { quantity: holding?.quantity ?? 0, low: holding?.low ?? false };
}

beforeEach(async () => {
  await markDatabase();
  job = await working();
  for (const consumable of [
    { name: "Tape strips", unit: "strip", unit_cost: 1200, reorder_kit: 5, reorder_central: 20 },
    { name: "Solvent", unit: "ml", unit_cost: 50 },
    { name: "Shampoo sachet", unit: "sachet", unit_cost: 800 },
  ]) {
    expect((await job.opsPost("/api/consumables", consumable)).status).toBe(200);
  }
  await job.opsPost("/api/service-usage", {
    visit_type: "service",
    tier: "standard",
    items: [
      { code: "tape_strips", quantity: 4 },
      { code: "solvent", quantity: 10 },
    ],
  });
});

describe("the ledger", () => {
  it("takes a delivery into the central store, recorded under who took it", async () => {
    const answer = await job.opsPost("/api/stock/deliveries", {
      consumable_code: "tape_strips",
      quantity: 100,
      note: "Supplier's note 4417",
    });

    expect(answer.status).toBe(200);
    expect(await held("tape_strips", null)).toEqual({ quantity: 100, low: false });
    expect((await stock()).movements).toEqual([
      expect.objectContaining({
        consumable_code: "tape_strips",
        technician_id: null,
        quantity: 100,
        reason: "received",
      }),
    ]);
    const audit = await env.DB.prepare("SELECT actor, detail FROM audit_log WHERE action = 'stock.receive'").first();
    expect(audit).toEqual({ actor: "ops@localhost", detail: JSON.stringify({ quantity: 100 }) });
  });

  it("moves stock from the store to a kit in two rows, and each place holds the sum of its own", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 100 });
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 30, from: null, to: IMRAN });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 10,
      from: IMRAN,
      to: SAMEER,
    });

    expect(await held("tape_strips", null)).toEqual({ quantity: 70, low: false });
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 20, low: false });
    expect(await held("tape_strips", SAMEER)).toEqual({ quantity: 10, low: false });
    const pairs = await env.DB.prepare(
      "SELECT COUNT(DISTINCT transfer_id) AS transfers, COUNT(*) AS rows, SUM(quantity) AS net FROM stock_movements WHERE reason = 'transferred'",
    ).first();
    expect(pairs).toEqual({ transfers: 2, rows: 4, net: 0 });
  });

  it.each([
    ["to the place it came from", { from: null, to: null }, "to"],
    ["from a kit nobody has", { from: "44444444-4444-4444-8444-444444444444", to: IMRAN }, "from"],
    ["of a consumable nobody added", { consumable_code: "glue", from: null, to: IMRAN }, "consumable_code"],
  ])("refuses a transfer %s, and moves nothing", async (_, body, field) => {
    const answer = await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 5, ...body });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: [field] } });
    expect((await stock()).movements).toEqual([]);
  });

  it("writes the difference a count found, nought when it agrees, and says when each place was counted", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 500 });

    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", technician_id: null, counted: 480 });
    expect(await held("solvent", null)).toEqual({ quantity: 480, low: false });
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", technician_id: null, counted: 480 });

    const counts = await env.DB.prepare(
      "SELECT quantity FROM stock_movements WHERE reason = 'counted' ORDER BY created_at, rowid",
    ).all<{ quantity: number }>();
    expect(counts.results.map((row) => row.quantity)).toEqual([-20, 0]);
    const holding = (await stock()).holdings.find(
      (each) => each.consumable_code === "solvent" && each.technician_id === null,
    );
    expect(holding?.counted_at).toBe("2026-09-21T06:30:00.000Z");
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'stock.count' ORDER BY id").first<{
      detail: string;
    }>();
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({ place: "central", counted: 480, held: 500, difference: -20 });
  });

  it("writes off a loss with what happened, and wants the words", async () => {
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "shampoo_sachet",
      quantity: 5,
      from: null,
      to: IMRAN,
    });

    expect(
      (
        await job.opsPost("/api/stock/write-offs", {
          consumable_code: "shampoo_sachet",
          technician_id: IMRAN,
          quantity: 2,
        })
      ).status,
    ).toBe(400);
    const answer = await job.opsPost("/api/stock/write-offs", {
      consumable_code: "shampoo_sachet",
      technician_id: IMRAN,
      quantity: 2,
      note: "Two burst in the heat",
    });
    expect(answer.status).toBe(200);
    expect(await held("shampoo_sachet", IMRAN)).toEqual({ quantity: 3, low: false });
  });

  it("lists the central store first, then each active technician's kit", async () => {
    const { places } = await stock();
    expect(places).toEqual([
      { technician_id: null, name: null, active: true },
      { technician_id: IMRAN, name: "Imran Qureshi", active: true },
      { technician_id: SAMEER, name: "Sameer Bhatt", active: true },
    ]);
  });

  it("keeps a kit a technician who left still holds, and drops one that holds nothing", async () => {
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 5, from: null, to: IMRAN });
    await env.DB.prepare("UPDATE technicians SET active = 0").run();

    const { places } = await stock();
    expect(places.map((place) => place.technician_id)).toEqual([null, IMRAN]);
    expect(places[1]?.active).toBe(false);

    // Emptied back into the store, his kit holds nothing, and its column goes.
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 5, from: IMRAN, to: null });
    expect((await stock()).places.map((place) => place.technician_id)).toEqual([null]);
  });
});

describe("low stock", () => {
  it("raises one alert for a kit that falls to its level, and closes it once the kit is stocked again", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 100 });
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 8, from: null, to: IMRAN });
    await job.workTo("consumables");

    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 4 }] },
      "event-consumables-01",
    );
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 4, low: true });
    expect(job.deps.alerts).toEqual([
      expect.stringContaining(`Stock is low in technician ${IMRAN}'s kit: Tape strips 4 strip (level 5)`),
    ]);
    expect(job.deps.alerts[0]).not.toContain("Imran");

    // Lower still, and the same alert is counted, not told again.
    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 6 }] },
      "event-consumables-02",
    );
    expect(job.deps.alerts).toHaveLength(1);
    const open = await env.DB.prepare("SELECT count FROM alerts WHERE key = ?1 AND resolved_at IS NULL")
      .bind(`low_stock:kit:${IMRAN}`)
      .first<{ count: number }>();
    expect(open?.count).toBe(2);

    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 10, from: null, to: IMRAN });
    const closed = await env.DB.prepare("SELECT resolved_at FROM alerts WHERE key = ?1")
      .bind(`low_stock:kit:${IMRAN}`)
      .first<{ resolved_at: string | null }>();
    expect(closed?.resolved_at).not.toBeNull();
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 12, low: false });
  });

  it("marks the central store low by its own level, and tells nobody of a place that only gained", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 10 });
    expect(await held("tape_strips", null)).toEqual({ quantity: 10, low: true });
    expect(job.deps.alerts).toEqual([]);

    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 2, from: null, to: IMRAN });
    expect(job.deps.alerts).toEqual([
      expect.stringContaining("Stock is low in the central store: Tape strips 8 strip (level 20)"),
    ]);
  });

  // A low-stock alert stayed open after its consumable was retired: no movement came to look again.
  it("closes a place's alert once what it was low on is retired", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 10 });
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 2, from: null, to: IMRAN });
    expect(job.deps.alerts).toEqual([expect.stringContaining("Stock is low in the central store")]);
    expect(await lowPlaces()).toBe(1);

    const retired = await job.opsPost("/api/consumables/tape_strips/retire", { from: "2026-09-21" });
    expect(retired.status).toBe(200);
    expect(await lowPlaces()).toBe(0);
    const open = await env.DB.prepare(
      "SELECT key FROM alerts WHERE key >= 'low_stock:' AND key < 'low_stock;' AND resolved_at IS NULL",
    ).all();
    expect(open.results).toEqual([]);
  });

  it("never marks a consumable with no level, nor one retired", async () => {
    await job.opsPost("/api/stock/transfers", { consumable_code: "solvent", quantity: 1, from: null, to: IMRAN });
    expect(await held("solvent", IMRAN)).toEqual({ quantity: 1, low: false });

    await job.opsPost("/api/consumables/tape_strips/retire", { from: "2026-09-21" });
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 1, from: null, to: IMRAN });
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 1, low: false });
  });
});
