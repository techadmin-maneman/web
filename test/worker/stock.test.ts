// Stock of consumables in each technician's kit and the central store, and a job's
// use of them (src/routes/ops-stock.ts, src/domain/job-use.ts;
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordJobUse } from "../../src/domain/job-use.ts";
import { count } from "../../src/domain/stock.ts";
import { markDatabase, NOW, request } from "./helpers.ts";
import { IMRAN, JOB, SAMEER, working, type Working } from "./job-fixtures.ts";

interface Stock {
  consumables: { code: string; name: string; retired: boolean }[];
  places: { technician_id: string | null; name: string | null; active: boolean }[];
  holdings: {
    consumable_code: string;
    technician_id: string | null;
    quantity: number;
    low: boolean;
    counted_at: string | null;
  }[];
  movements: { consumable_code: string; technician_id: string | null; quantity: number; reason: string; by: string }[];
}

let job: Working;

const stock = async (): Promise<Stock> => (await request(job.ops, "/api/stock")).json<Stock>();

/** What a place holds of a consumable, as the Stock screen reads it. */
async function held(code: string, place: string | null): Promise<{ quantity: number; low: boolean }> {
  const holding = (await stock()).holdings.find(
    (each) => each.consumable_code === code && each.technician_id === place,
  );
  return { quantity: holding?.quantity ?? 0, low: holding?.low ?? false };
}

const usedRows = () =>
  env.DB.prepare(
    `SELECT consumable_code, technician_id, quantity, job_event_id FROM stock_movements
     WHERE reason = 'used' ORDER BY created_at, rowid`,
  ).all<{ consumable_code: string; technician_id: string; quantity: number; job_event_id: string }>();

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

describe("a job's use", () => {
  /** Tape strips and solvent into Imran's kit, and the job worked to its consumables step. */
  async function readyToRecord(): Promise<void> {
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 12, from: null, to: IMRAN });
    await job.opsPost("/api/stock/transfers", { consumable_code: "solvent", quantity: 100, from: null, to: IMRAN });
    await job.workTo("consumables");
  }

  it("gives the card every consumable offered, the service's own first with the count it expects", async () => {
    await job.opsPost("/api/consumables/shampoo_sachet/retire", { from: "2026-09-21" });
    await job.opsPost("/api/consumables", { name: "Bonding glue", unit: "ml", unit_cost: 90 });

    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<{ consumables: unknown }>();
    expect(card.consumables).toEqual([
      { code: "solvent", name: "Solvent", unit: "ml", expected: 10 },
      { code: "tape_strips", name: "Tape strips", unit: "strip", expected: 4 },
      { code: "bonding_glue", name: "Bonding glue", unit: "ml", expected: 0 },
    ]);
    // Never what one costs: no response to a technician carries an amount.
    expect(JSON.stringify(card)).not.toMatch(/cost|amount|paise|rupee/i);
  });

  // ADR 0087, amended by ADR 0085: a job's service is its own visit's, not its kind's standard one.
  it("gives a job of another service of its kind what that service expects", async () => {
    await env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('service', 'premium', 'Premium service visit', 120, 1, 'ops@maneman.in', '2026-09-20T06:00:00.000Z')`,
    ).run();
    await job.opsPost("/api/service-usage", {
      visit_type: "service",
      tier: "premium",
      items: [{ code: "tape_strips", quantity: 6 }],
    });
    await env.DB.prepare("UPDATE appointments SET tier = 'premium' WHERE id = ?1").bind(JOB).run();

    const card = await (
      await job.get(`/api/tech/jobs/${JOB}`)
    ).json<{
      consumables: { code: string; expected: number }[];
    }>();
    expect(card.consumables.map(({ code, expected }) => [code, expected])).toEqual([
      ["tape_strips", 6],
      ["shampoo_sachet", 0],
      ["solvent", 0],
    ]);
  });

  it("comes out of his kit as the step lands, with what the service expected and what one cost that day", async () => {
    await readyToRecord();
    const answer = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      {
        items: [
          { code: "tape_strips", quantity: 5 },
          { code: "shampoo_sachet", quantity: 1 },
        ],
      },
      "event-consumables-01",
    );

    expect(answer.status).toBe(202);
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 7, low: false });
    expect(await held("shampoo_sachet", IMRAN)).toEqual({ quantity: -1, low: false });
    const recorded = await env.DB.prepare(
      "SELECT consumable_code, name, quantity, expected_quantity, unit_cost FROM consumables_used ORDER BY name",
    ).all();
    expect(recorded.results).toEqual([
      { consumable_code: "shampoo_sachet", name: "Shampoo sachet", quantity: 1, expected_quantity: 0, unit_cost: 800 },
      { consumable_code: "tape_strips", name: "Tape strips", quantity: 5, expected_quantity: 4, unit_cost: 1200 },
    ]);
  });

  it("is written once however often the phone replays the step", async () => {
    await readyToRecord();
    const step = { items: [{ code: "tape_strips", quantity: 4 }] };
    for (let replay = 0; replay < 3; replay += 1) {
      const answer = await job.post(`/api/tech/jobs/${JOB}/consumables`, step, "event-consumables-01");
      expect(answer.status).toBe(202);
    }

    expect((await usedRows()).results).toEqual([
      expect.objectContaining({ consumable_code: "tape_strips", technician_id: IMRAN, quantity: -4 }),
    ]);
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 8, low: false });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS rows FROM consumables_used").first<{ rows: number }>())?.rows,
    ).toBe(1);
  });

  it("is written once for a step replayed after ops renamed the consumable", async () => {
    await readyToRecord();
    const step = { items: [{ code: "tape_strips", quantity: 4 }] };
    await job.post(`/api/tech/jobs/${JOB}/consumables`, step, "event-consumables-01");
    await env.DB.prepare("UPDATE consumables SET name = 'Contour tape' WHERE code = 'tape_strips'").run();
    const replayed = await job.post(`/api/tech/jobs/${JOB}/consumables`, step, "event-consumables-01");

    expect(replayed.status).toBe(202);
    expect((await env.DB.prepare("SELECT name, quantity FROM consumables_used").all()).results).toEqual([
      { name: "Tape strips", quantity: 4 },
    ]);
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 8, low: false });
  });

  it("is corrected by the difference when he sends the step again, and an older replay changes nothing", async () => {
    await readyToRecord();
    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 4 }] },
      "event-consumables-01",
    );
    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      {
        items: [
          { code: "tape_strips", quantity: 6 },
          { code: "solvent", quantity: 10 },
        ],
      },
      "event-consumables-02",
    );
    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 4 }] },
      "event-consumables-01",
    );

    expect((await usedRows()).results.map((row) => [row.consumable_code, row.quantity])).toEqual([
      ["tape_strips", -4],
      ["tape_strips", -2],
      ["solvent", -10],
    ]);
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 6, low: false });
    expect(await held("solvent", IMRAN)).toEqual({ quantity: 90, low: false });
  });

  it("still takes the step a phone queued by names before codes, matching each name it can", async () => {
    await readyToRecord();
    const answer = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      {
        items: [
          { name: "tape strips", quantity: 3 },
          { name: "Adhesive", quantity: 2 },
        ],
      },
      "event-consumables-01",
    );

    expect(answer.status).toBe(202);
    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 9, low: false });
    const recorded = await env.DB.prepare(
      "SELECT consumable_code, name, quantity, expected_quantity FROM consumables_used ORDER BY name",
    ).all();
    expect(recorded.results).toEqual([
      { consumable_code: null, name: "Adhesive", quantity: 2, expected_quantity: null },
      { consumable_code: "tape_strips", name: "Tape strips", quantity: 3, expected_quantity: 4 },
    ]);
  });

  it("refuses a code the catalogue does not hold, and takes one retired since the phone kept the job", async () => {
    await readyToRecord();
    const unknown = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "glue", quantity: 1 }] },
      "event-consumables-01",
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "invalid_request", fields: ["items"] } });

    await job.opsPost("/api/consumables/solvent/retire", { from: "2026-09-21" });
    const retired = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "solvent", quantity: 8 }] },
      "event-consumables-02",
    );
    expect(retired.status).toBe(202);
    expect(await held("solvent", IMRAN)).toMatchObject({ quantity: 92 });
  });
});

// Two writes to one kit at once: each read the kit's rows before the other wrote. The Worker serves requests
// concurrently, so a count and a job's use, or two of a job's consumables steps, can land so (ADR 0087, C26).
describe("writes that land together", () => {
  /** D1's batch, on the prototype every statement's database shares, and the real method a spy calls on to. */
  function d1Batch() {
    const database = Object.getPrototypeOf(env.DB) as D1Database;
    const real = Reflect.get(database, "batch") as (
      this: D1Database,
      statements: D1PreparedStatement[],
    ) => Promise<D1Result[]>;
    return { database, real };
  }

  /**
   * Holds the next batch written until `release`: a write whose rows were read before another lands, and whose
   * statements run after it.
   */
  function holdNextWrite(): { arrived: Promise<undefined>; release: () => void } {
    const { database, real } = d1Batch();
    const arrived = Promise.withResolvers<undefined>();
    const released = Promise.withResolvers<undefined>();
    vi.spyOn(database, "batch").mockImplementationOnce(async function (this: D1Database, statements) {
      arrived.resolve(undefined);
      await released.promise;
      return real.call(this, statements);
    });
    return {
      arrived: arrived.promise,
      release: () => {
        released.resolve(undefined);
      },
    };
  }

  // The spies are on D1's own prototype, which every test shares.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const byOps = { actor: { kind: "staff" as const, id: "ops@localhost" }, requestId: "count-1", now: NOW };

  it("leaves a kit holding what ops counted when a job's use lands between the count's read and its write", async () => {
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 12, from: null, to: IMRAN });
    await job.workTo("consumables");

    // Ops count 8 in the kit: 12 less the 4 the job used, whose step reaches us while the count is written.
    const waiting = holdNextWrite();
    const counting = count(env.DB, { code: "tape_strips", place: IMRAN, counted: 8, note: null }, byOps);
    await waiting.arrived;
    await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 4 }] },
      "event-consumables-01",
    );
    waiting.release();
    expect(await counting).toEqual({ ok: true, lowered: [] });

    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 8, low: false });
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'stock.count'").all<{
      detail: string;
    }>();
    expect(audit.results.map((row) => JSON.parse(row.detail) as unknown)).toEqual([
      { place: IMRAN, counted: 8, held: 8, difference: 0 },
    ]);
  });

  it("gives up on a count, writing nothing, if the place moves each time it is read", async () => {
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 500 });
    // Before each of the count's writes, a delivery lands in the store.
    const { database, real } = d1Batch();
    vi.spyOn(database, "batch").mockImplementation(async function (this: D1Database, statements) {
      await env.DB.prepare(
        `INSERT INTO stock_movements (id, consumable_code, location, quantity, reason, actor_kind, actor, created_at)
         VALUES (?1, 'solvent', 'central', 10, 'received', 'staff', 'someone@localhost', ?2)`,
      )
        .bind(crypto.randomUUID(), NOW.toISOString())
        .run();
      return real.call(this, statements);
    });

    await expect(count(env.DB, { code: "solvent", place: null, counted: 480, note: null }, byOps)).rejects.toThrow(
      "the stock of solvent moved each time it was counted",
    );
    vi.restoreAllMocks(); // the Stock screen's own read is a batch too
    expect(await held("solvent", null)).toMatchObject({ quantity: 530 });
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stock.count'").first();
    expect(audit).toEqual({ n: 0 });
  });

  it("takes a job's use once when an older step is written after a newer one landed", async () => {
    await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity: 12, from: null, to: IMRAN });
    await job.workTo("consumables");
    // The phone's first step, read and held before its write.
    await env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         updated_at)
       VALUES ('row-consumables-01', ?1, 'event-consumables-01', ?2, 'consumables', ?3, ?4, ?4, ?4)`,
    )
      .bind(JOB, IMRAN, JSON.stringify({ items: [{ code: "tape_strips", quantity: 4 }] }), NOW.toISOString())
      .run();
    const waiting = holdNextWrite();
    const first = recordJobUse(env.DB, { job: { id: JOB, type: "service" }, technicianId: IMRAN, now: NOW });
    await waiting.arrived;

    // The corrected step lands whole while the first waits.
    const corrected = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code: "tape_strips", quantity: 6 }] },
      "event-consumables-02",
    );
    expect(corrected.status).toBe(202);
    waiting.release();
    await first;

    expect(await held("tape_strips", IMRAN)).toEqual({ quantity: 6, low: false });
    expect((await usedRows()).results.map((row) => row.quantity)).toEqual([-6]);
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

    const retired = await job.opsPost("/api/consumables/tape_strips/retire", { from: "2026-09-21" });
    expect(retired.status).toBe(200);
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
