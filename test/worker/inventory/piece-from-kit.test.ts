// The piece step scanned from the kit (src/routes/tech/jobs.piece.ts, src/domain/inventory/piece-use.ts,
// src/domain/inventory/piece-returns.ts; docs/decisions/0163-pieces-scanned-from-the-kit.md). NOW is Monday 21 September
// 2026, 12 noon in India.
//
// What these hold: the job card lists each kit hair system's labelled pieces; a label one of them carries names its
// hair system and lot whatever the step said; an expired one is refused; and a piece that comes off at a replacement is
// held in the kit as returned, its unit with it where it is one of ours.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, PERSON, working, type Working } from "../job-fixtures.ts";

let job: Working;
let code: string;

async function added(grey: number): Promise<string> {
  const answer = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: grey,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  return (await answer.json<{ code: string }>()).code;
}

/** The labels in Imran's kit of a hair system, delivered with the lot given and handed to them. */
async function inTheKit(of: string, lot: Record<string, string>): Promise<string[]> {
  await job.opsPost("/api/stock/deliveries", { consumable_code: of, quantity: 2, ...lot });
  await job.opsPost("/api/stock/transfers", { consumable_code: of, quantity: 2, from: "central", to: IMRAN });
  const { units } = await (
    await request(job.ops, `/api/stock/units?consumable_code=${of}&place_id=${IMRAN}`)
  ).json<{ units: { code: string }[] }>();
  return units.map((unit) => unit.code).sort();
}

async function setUp(type: string): Promise<void> {
  await markDatabase();
  job = await working(type);
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  code = await added(20);
}

describe("a piece scanned from the kit", () => {
  beforeEach(async () => {
    await setUp("first_fit");
  });

  it("is listed on the job card, and names its hair system and lot whatever the step said", async () => {
    const other = await added(30);
    const [label = ""] = await inTheKit(code, { lot_code: "HS-1", expires_on: "2028-03-31" });
    await inTheKit(other, {});
    const card = await (
      await job.get(`/api/tech/jobs/${JOB}`)
    ).json<{ kit_hair_systems: { code: string; units: { code: string; lot_code: string | null }[] }[] }>();
    const listed = card.kit_hair_systems.find((each) => each.code === code);
    expect(listed?.units.map((unit) => unit.code)).toContain(label);
    expect(listed?.units[0]?.lot_code).toBe("HS-1");

    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
    const step = await job.post(
      `/api/tech/jobs/${JOB}/piece`,
      { piece_code: label, stock_code: other },
      "event-piece-01",
    );
    expect(step.status).toBe(202);
    const body = await env.DB.prepare("SELECT body FROM job_events WHERE kind = 'piece'").first<string>("body");
    expect(JSON.parse(body ?? "{}")).toMatchObject({ piece_code: label, stock_code: code, supplier_lot: "HS-1" });
    expect(
      await env.DB.prepare("SELECT state FROM stock_units WHERE code = ?1").bind(label).first<string>("state"),
    ).toBe("fitted");
  });

  it("is refused once it has expired", async () => {
    const [label = ""] = await inTheKit(code, { lot_code: "OLD", expires_on: "2026-09-20" });
    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
    const step = await job.post(`/api/tech/jobs/${JOB}/piece`, { piece_code: label }, "event-piece-01");
    expect(step.status).toBe(400);
    expect((await step.json<{ error: { fields?: string[] } }>()).error.fields).toEqual(["piece_code"]);
  });
});

describe("a piece that comes off", () => {
  beforeEach(async () => {
    await setUp("replacement");
  });

  it("is held in the kit as returned, its unit with it, once however often the step lands", async () => {
    const [worn = "", fresh = ""] = await inTheKit(code, {});
    // The worn piece went on Rohit at an earlier visit.
    await env.DB.batch([
      env.DB.prepare("UPDATE stock_units SET state = 'fitted', place = NULL WHERE code = ?1").bind(worn),
      env.DB.prepare(
        `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, synced_at)
         VALUES ('pc-1', 'pc-1', ?1, ?2, '2026-03-21T06:30:00.000Z', ?3)`,
      ).bind(PERSON, worn, NOW.toISOString()),
    ]);
    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");
    const step = {
      piece_code: fresh,
      stock_code: code,
      old_piece: { piece_code: worn, failure_reason: "Base lifting at the front" },
    };
    for (let replay = 0; replay < 2; replay += 1) {
      expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-01")).status).toBe(202);
    }
    const { results } = await env.DB.prepare(
      "SELECT piece_code, technician_id, reason, handed_in_at FROM piece_returns",
    ).all();
    expect(results).toEqual([
      { piece_code: worn, technician_id: IMRAN, reason: "Base lifting at the front", handed_in_at: null },
    ]);
    expect(await env.DB.prepare("SELECT state, place FROM stock_units WHERE code = ?1").bind(worn).first()).toEqual({
      state: "returned",
      place: IMRAN,
    });
  });

  it("is held in the kit to hand in when it came off because it was due, with no reason", async () => {
    const [worn = "", fresh = ""] = await inTheKit(code, {});
    await env.DB.prepare("UPDATE stock_units SET state = 'fitted', place = NULL WHERE code = ?1").bind(worn).run();
    await job.workTo("piece");
    const step = { piece_code: fresh, stock_code: code, old_piece: { piece_code: worn } };
    expect((await job.post(`/api/tech/jobs/${JOB}/piece`, step, "event-piece-01")).status).toBe(202);
    const returned = await env.DB.prepare("SELECT piece_code, reason FROM piece_returns").all();
    expect(returned.results).toEqual([{ piece_code: worn, reason: null }]);
    expect(await env.DB.prepare("SELECT state, place FROM stock_units WHERE code = ?1").bind(worn).first()).toEqual({
      state: "returned",
      place: IMRAN,
    });
  });
});
