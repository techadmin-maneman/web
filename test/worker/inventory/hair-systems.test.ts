// Hair systems in stock (src/domain/inventory/hair-systems.ts, src/domain/inventory/piece-use.ts;
// docs/decisions/0156-hair-systems-in-stock.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: ops add a stock code for a spec, named from it, and no two share one; the job card lists the
// hair systems the technician's kit holds; the piece step takes the one it names out of the kit once, however often it
// lands, and a later step naming another corrects by the difference; a code that is no hair system is refused; and
// the consumables step never offers, takes or gives back a hair system.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, working, type Working } from "../job-fixtures.ts";
import { type Stock } from "./stock-fixtures.ts";
import { aPackage } from "../fixtures/packages.ts";

let job: Working;

const SPEC = {
  product: "essential",
  base_width_in: 8,
  base_length_in: 10,
  colour: "1B",
  grey_percent: 20,
  density_percent: 100,
};

const stock = async (): Promise<Stock> => (await request(job.ops, "/api/stock")).json<Stock>();

const heldInKit = async (code: string) =>
  (await stock()).holdings.find((each) => each.consumable_code === code && each.place_id === IMRAN)?.quantity ?? 0;

const errorOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

/** Adds a hair system for the spec, answering its stock code. */
async function added(spec: Record<string, unknown> = SPEC): Promise<string> {
  const answer = await job.opsPost("/api/hair-systems", { ...spec, unit_cost: 1_200_000, reorder_kit: 1 });
  expect(answer.status).toBe(200);
  return (await answer.json<{ code: string }>()).code;
}

/** A first fit worked to its piece step: the checklist and what was used sent. */
async function readyToFit(): Promise<void> {
  await job.workTo("consumables");
  await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
}

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

describe("a hair system's stock code", () => {
  it("is added for a spec, named from it and counted in pieces, and no two share a spec", async () => {
    const code = await added();
    const { consumables } = await (
      await request(job.ops, "/api/consumables")
    ).json<{
      consumables: { code: string; name: string; unit: string; hair_system: unknown }[];
    }>();
    expect(consumables.find((each) => each.code === code)).toMatchObject({
      name: "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 100% density",
      unit: "piece",
      hair_system: SPEC,
    });

    const twice = await job.opsPost("/api/hair-systems", { ...SPEC, unit_cost: 1 });
    expect((await errorOf(twice)).fields).toEqual(["hair_system"]);
    const noSuchProduct = await job.opsPost("/api/hair-systems", { ...SPEC, product: "platinum", unit_cost: 1 });
    expect((await errorOf(noSuchProduct)).fields).toEqual(["product"]);
  });

  it("takes its package's new name when that is renamed, the rest of its name kept", async () => {
    const { hairSystem } = await aPackage({ code: "gold", name: "Mane Man Gold", firstFit: 1_000_000 });
    const renamed = await request(job.ops, "/api/packages/gold", {
      method: "PATCH",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Mane Man Platinum" }),
    });
    expect(renamed.status).toBe(200);
    const named = await env.DB.prepare("SELECT name FROM consumables WHERE code = ?1")
      .bind(hairSystem)
      .first<string>("name");
    expect(named).toBe(`Mane Man Platinum · ${hairSystem}`);
  });

  it("is never offered to the consumables step, nor set as a service's expected use", async () => {
    const code = await added();
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<{ consumables: { code: string }[] }>();
    expect(card.consumables.map((each) => each.code)).not.toContain(code);

    const usage = await job.opsPost("/api/service-usage", {
      visit_type: "first_fit",
      tier: "standard",
      items: [{ code, quantity: 1 }],
    });
    expect((await errorOf(usage)).fields).toEqual(["items.0.code"]);
  });
});

describe("a piece fitted", () => {
  it("comes out of the kit once however often the step lands, and a later step corrects by the difference", async () => {
    const first = await added();
    const second = await added({ ...SPEC, grey_percent: 30 });
    for (const code of [first, second]) {
      await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 5 });
      await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 2, from: "central", to: IMRAN });
    }
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<{ kit_hair_systems: { code: string }[] }>();
    expect(card.kit_hair_systems.map((each) => each.code).sort()).toEqual([first, second].sort());

    await readyToFit();
    const step = { piece_code: "MM-STD-4417-B", stock_code: first };
    for (let replay = 0; replay < 3; replay += 1) {
      expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-01")).status).toBe(202);
    }
    expect(await heldInKit(first)).toBe(1);

    await job.post(`/api/tech/jobs/${JOB}/piece`, { ...step, stock_code: second }, "event-piece-02");
    expect(await heldInKit(first)).toBe(2);
    expect(await heldInKit(second)).toBe(1);
    expect(job.deps.alerts).toEqual([
      expect.stringContaining(
        `of Mane Man Essential · 8 × 10 in · #1B · 20% grey · 100% density for technician ${IMRAN}'s kit on the Stock page: 1 piece left, at or below its level`,
      ),
      expect.stringContaining("of Mane Man Essential · 8 × 10 in · #1B · 30% grey · 100% density for technician"),
    ]);
  });

  it("refuses a code that is no hair system, and takes nothing for a piece from elsewhere", async () => {
    const code = await added();
    await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 5 });
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 2, from: "central", to: IMRAN });
    await readyToFit();

    const refused = await job.post(
      `/api/tech/jobs/${JOB}/piece`,
      { piece_code: "MM-STD-4417-B", stock_code: "tape_strips" },
      "event-piece-01",
    );
    expect((await errorOf(refused)).fields).toEqual(["stock_code"]);

    await job.post(`/api/tech/jobs/${JOB}/piece`, { piece_code: "MM-STD-4417-B" }, "event-piece-02");
    expect(await heldInKit(code)).toBe(2);
  });

  it("is never given back by the consumables step", async () => {
    const code = await added();
    await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 5 });
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 2, from: "central", to: IMRAN });
    await readyToFit();
    await job.post(`/api/tech/jobs/${JOB}/piece`, { piece_code: "MM-STD-4417-B", stock_code: code }, "event-piece-01");

    const refused = await job.post(
      `/api/tech/jobs/${JOB}/consumables`,
      { items: [{ code, quantity: 1 }] },
      "event-consumables-02",
    );
    expect((await errorOf(refused)).fields).toEqual(["items"]);
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-03");
    expect(await heldInKit(code)).toBe(1);
  });
});
