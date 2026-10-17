// Stock of consumables in each technician's kit and the warehouse, and a job's
// use of them (src/routes/ops/stock.ts, src/domain/field/job-use.ts;
// docs/decisions/0087-consumables-and-stock.md). NOW is Monday 21 September 2026,
// 12 noon in India.
//
// What these hold: what a place holds is the sum of its rows; a delivery, a
// transfer, a count and a write-off each write what they say, with the Access
// identity behind them; a job's use comes out of the technician's kit once,
// however often their step is replayed, and a later step corrects it by the
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

/** The places the Stock screen marks low, or below zero, which the badge counts the same. */
const markedLow = async (): Promise<number> => {
  const { holdings } = await stock();
  return new Set(holdings.filter((each) => each.low || each.quantity < 0).map((each) => each.place_id)).size;
};

/** What a place holds of a consumable, as the Stock screen reads it. */
async function held(code: string, place: string): Promise<{ quantity: number; low: boolean }> {
  const holding = (await stock()).holdings.find((each) => each.consumable_code === code && each.place_id === place);
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
  it("takes a delivery into the warehouse, recorded under who took it", async () => {
    const answer = await job.opsPost("/api/stock/deliveries", {
      consumable_code: "tape_strips",
      quantity: 100,
      note: "Supplier's note 4417",
    });

    expect(answer.status).toBe(200);
    expect(await held("tape_strips", "central")).toEqual({ quantity: 100, low: false });
    expect((await stock()).movements).toEqual([
      expect.objectContaining({
        consumable_code: "tape_strips",
        place_id: "central",
        quantity: 100,
        reason: "received",
      }),
    ]);
    const audit = await env.DB.prepare("SELECT actor, detail FROM audit_log WHERE action = 'stock.receive'").first();
    expect(audit).toEqual({ actor: "ops@localhost", detail: JSON.stringify({ quantity: 100 }) });
  });

  it("moves stock from the store to a kit in two rows, and each place holds the sum of its own", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 100 });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 30,
      from: "central",
      to: IMRAN,
    });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 10,
      from: IMRAN,
      to: SAMEER,
    });

    expect(await held("tape_strips", "central")).toEqual({ quantity: 70, low: false });
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 20, low: false });
    expect(await held("tape_strips", SAMEER)).toEqual({ quantity: 10, low: false });
    const pairs = await env.DB.prepare(
      "SELECT COUNT(DISTINCT transfer_id) AS transfers, COUNT(*) AS rows, SUM(quantity) AS net FROM stock_movements WHERE reason = 'transferred'",
    ).first();
    expect(pairs).toEqual({ transfers: 2, rows: 4, net: 0 });
  });

  it.each([
    ["to the place it came from", { from: "central", to: "central" }, "to"],
    ["from a kit nobody has", { from: "44444444-4444-4444-8444-444444444444", to: IMRAN }, "from"],
    ["of a consumable nobody added", { consumable_code: "glue", from: "central", to: IMRAN }, "consumable_code"],
  ])("refuses a transfer %s, and moves nothing", async (_, body, field) => {
    const answer = await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 5, ...body });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: [field] } });
    expect((await stock()).movements).toEqual([]);
  });

  it("writes the difference a count found, nought when it agrees, and says when each place was counted", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 500 });

    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: "central", counted: 480 });
    expect(await held("solvent", "central")).toEqual({ quantity: 480, low: false });
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: "central", counted: 480 });

    const counts = await env.DB.prepare(
      "SELECT quantity FROM stock_movements WHERE reason = 'counted' ORDER BY created_at, rowid",
    ).all<{ quantity: number }>();
    expect(counts.results.map((row) => row.quantity)).toEqual([-20, 0]);
    const holding = (await stock()).holdings.find(
      (each) => each.consumable_code === "solvent" && each.place_id === "central",
    );
    expect(holding?.counted_at).toBe("2026-09-21T06:30:00.000Z");
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'stock.count' ORDER BY id").first<{
      detail: string;
    }>();
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({ place: "central", counted: 480, held: 500, difference: -20 });
  });

  it("sends and writes off no more than a place holds, and writes nothing when it refuses", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 10 });
    const refusals = [
      await job.opsPost("/api/stock/transfers", {
        consumable_code: "solvent",
        quantity: 11,
        from: "central",
        to: IMRAN,
      }),
      await job.opsPost("/api/stock/transfers", {
        consumable_code: "solvent",
        quantity: 11,
        from: "central",
        to: IMRAN,
        wait_for_scan: true,
      }),
      await job.opsPost("/api/stock/write-offs", {
        consumable_code: "solvent",
        place_id: "central",
        quantity: 11,
        note: "Spilt",
      }),
    ];
    for (const refused of refusals) {
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { fields: ["quantity.held"] } });
    }
    expect(await held("solvent", "central")).toEqual({ quantity: 10, low: false });
    const written = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM stock_transfers) AS transfers, (SELECT COUNT(*) FROM audit_log WHERE action IN ('stock.transfer', 'stock.send', 'stock.write_off')) AS entries",
    ).first();
    expect(written).toEqual({ transfers: 0, entries: 0 });

    const sent = await job.opsPost("/api/stock/transfers", {
      consumable_code: "solvent",
      quantity: 10,
      from: "central",
      to: IMRAN,
    });
    expect(sent.status).toBe(200);
    expect(await held("solvent", IMRAN)).toEqual({ quantity: 10, low: false });
  });

  it("writes off a loss with what happened, and wants the words", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "shampoo_sachet", quantity: 5 });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "shampoo_sachet",
      quantity: 5,
      from: "central",
      to: IMRAN,
    });

    expect(
      (
        await job.opsPost("/api/stock/write-offs", {
          consumable_code: "shampoo_sachet",
          place_id: IMRAN,
          quantity: 2,
        })
      ).status,
    ).toBe(400);
    const answer = await job.opsPost("/api/stock/write-offs", {
      consumable_code: "shampoo_sachet",
      place_id: IMRAN,
      quantity: 2,
      note: "Two burst in the heat",
    });
    expect(answer.status).toBe(200);
    expect(await held("shampoo_sachet", IMRAN)).toEqual({ quantity: 3, low: false });
  });

  it("lists the warehouse first, then each active technician's kit", async () => {
    const { places } = await stock();
    const kit = { kind: "kit", parent_id: "central", active: true };
    expect(places).toEqual([
      {
        id: "central",
        kind: "warehouse",
        name: "National warehouse",
        parent_id: null,
        zone: null,
        city: null,
        active: true,
      },
      expect.objectContaining({ ...kit, id: IMRAN, name: "Imran Qureshi" }),
      expect.objectContaining({ ...kit, id: SAMEER, name: "Sameer Bhatt" }),
    ]);
  });

  it("keeps a kit a technician who left still holds, and drops one that holds nothing", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 5 });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 5,
      from: "central",
      to: IMRAN,
    });
    await env.DB.prepare("UPDATE technicians SET active = 0").run();

    const { places } = await stock();
    expect(places.map((place) => place.id)).toEqual(["central", IMRAN]);
    expect(places[1]?.active).toBe(false);

    // Emptied back into the store, their kit holds nothing, and its column goes.
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 5,
      from: IMRAN,
      to: "central",
    });
    expect((await stock()).places.map((place) => place.id)).toEqual(["central"]);
  });
});

describe("low stock", () => {
  it("raises one alert for a kit that falls to its level, and closes it once the kit is stocked again", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 100 });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 8,
      from: "central",
      to: IMRAN,
    });
    await job.workTo("consumables");

    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 4 }] },
      "event-consumables-01",
    );
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 4, low: true });
    expect(job.deps.alerts).toEqual([
      expect.stringContaining(
        `of Tape strips for technician ${IMRAN}'s kit on the Stock page: 4 strips left, at or below its level of 5.`,
      ),
    ]);
    expect(job.deps.alerts[0]).not.toContain("Imran");
    // The console names the kit by its technician, as the chat is never told.
    const listed = await (await request(job.ops, "/api/alerts")).json<{ alerts: { message: string }[] }>();
    expect(listed.alerts.map((alert) => alert.message)).toEqual([
      expect.stringContaining(
        "of Tape strips for Imran Qureshi's kit on the Stock page: 4 strips left, at or below its level of 5.",
      ),
    ]);

    // Lower still, and the same alert is counted, not told again.
    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 6 }] },
      "event-consumables-02",
    );
    expect(job.deps.alerts).toHaveLength(1);
    const open = await env.DB.prepare("SELECT count FROM alerts WHERE key = ?1 AND resolved_at IS NULL")
      .bind(`low_stock:kit:${IMRAN}:tape_strips`)
      .first<{ count: number }>();
    expect(open?.count).toBe(2);

    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 10,
      from: "central",
      to: IMRAN,
    });
    const closed = await env.DB.prepare("SELECT resolved_at FROM alerts WHERE key = ?1")
      .bind(`low_stock:kit:${IMRAN}:tape_strips`)
      .first<{ resolved_at: string | null }>();
    expect(closed?.resolved_at).not.toBeNull();
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 12, low: false });
  });

  it("marks the warehouse low by its own level, and tells nobody of a place that only gained", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 10 });
    expect(await held("tape_strips", "central")).toEqual({ quantity: 10, low: true });
    expect(job.deps.alerts).toEqual([]);

    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 2,
      from: "central",
      to: IMRAN,
    });
    expect(job.deps.alerts).toEqual([
      expect.stringContaining(
        "of Tape strips for National warehouse on the Stock page: 8 strips left, at or below its level of 20.",
      ),
    ]);
  });

  // A low-stock alert stayed open after its consumable was retired: no movement came to look again.
  it("closes a place's alert once what it was low on is retired", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 10 });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 2,
      from: "central",
      to: IMRAN,
    });
    expect(job.deps.alerts).toEqual([expect.stringContaining("of Tape strips for National warehouse")]);
    // The warehouse, and both kits at or below the kit's level, as the Stock screen marks them.
    expect(await lowPlaces()).toBe(3);
    expect(await lowPlaces()).toBe(await markedLow());

    const retired = await job.opsPost("/api/consumables/tape_strips/retire", { from: "2026-09-21" });
    expect(retired.status).toBe(200);
    expect(await lowPlaces()).toBe(0);
    const open = await env.DB.prepare(
      "SELECT key FROM alerts WHERE key >= 'low_stock:' AND key < 'low_stock;' AND resolved_at IS NULL",
    ).all();
    expect(open.results).toEqual([]);
  });

  // The Gurgaon stockroom at -288 strips was marked neither low nor counted by the badge.
  it("counts a place below zero as low, whatever its level", async () => {
    await env.DB.prepare("UPDATE consumables SET reorder_kit = NULL, reorder_central = NULL, reorder_store = NULL").run();
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 1 });
    expect(await lowPlaces()).toBe(0);
    await env.DB.prepare("UPDATE stock_balances SET quantity = -4 WHERE consumable_code = 'solvent'").run();
    expect(await lowPlaces()).toBe(1);
    expect(await markedLow()).toBe(1);
  });

  it("never marks a consumable with no level, nor one retired", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 1 });
    await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 1 });
    await job.opsPost("/api/stock/transfers", { consumable_code: "solvent", quantity: 1, from: "central", to: IMRAN });
    expect(await held("solvent", IMRAN)).toEqual({ quantity: 1, low: false });

    await job.opsPost("/api/consumables/tape_strips/retire", { from: "2026-09-21" });
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 1,
      from: "central",
      to: IMRAN,
    });
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 1, low: false });
  });

  it("tells each item a place is low on apart, and closes each once that item is no longer low", async () => {
    await job.opsPost("/api/consumables", { name: "Adhesive", unit: "ml", unit_cost: 900, reorder_kit: 50 });
    const openKeys = async () =>
      (
        await env.DB.prepare(
          "SELECT key FROM alerts WHERE key >= 'low_stock:' AND key < 'low_stock;' AND resolved_at IS NULL ORDER BY key",
        ).all<{ key: string }>()
      ).results.map((row) => row.key);
    for (const [code, quantity] of [
      ["tape_strips", 10],
      ["adhesive", 60],
    ] as const) {
      await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 100 });
      await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity, from: "central", to: IMRAN });
    }
    await job.opsPost("/api/stock/counts", { consumable_code: "tape_strips", place_id: IMRAN, counted: 3 });
    await job.opsPost("/api/stock/counts", { consumable_code: "adhesive", place_id: IMRAN, counted: 40 });
    expect(job.deps.alerts).toEqual([
      expect.stringContaining("of Tape strips for technician"),
      expect.stringContaining("of Adhesive for technician"),
    ]);
    expect(await openKeys()).toEqual([`low_stock:kit:${IMRAN}:adhesive`, `low_stock:kit:${IMRAN}:tape_strips`]);
    // Imran's kit, and Sameer's, which holds none of either.
    expect(await lowPlaces()).toBe(2);
    expect(await lowPlaces()).toBe(await markedLow());

    await job.opsPost("/api/stock/counts", { consumable_code: "tape_strips", place_id: IMRAN, counted: 12 });
    expect(await openKeys()).toEqual([`low_stock:kit:${IMRAN}:adhesive`]);
  });
});
