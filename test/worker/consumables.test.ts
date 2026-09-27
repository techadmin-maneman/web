// The consumables ops keep, and what each service is expected to use, on the ops
// surface (src/routes/ops-consumables.ts, docs/decisions/0087-consumables-and-stock.md).
// NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a consumable is added, renamed, costed, retired and
// restored, each with its audit entry and never two of one name; a service's
// expected use names only consumables and services that exist; and the
// console is told where each stands in FSM's catalogue.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "./helpers.ts";

let ops: App;

const POST = { "Content-Type": "application/json", Origin: "https://maneman.test" };

const post = (path: string, body?: unknown) =>
  request(ops, path, { method: "POST", headers: POST, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

interface Consumable {
  code: string;
  name: string;
  unit: string;
  unit_cost: number;
  reorder_kit: number | null;
  reorder_central: number | null;
  retired_from: string | null;
  offered: boolean;
  fsm: { state: string; item_id: string | null; name: string | null };
}

interface Consumables {
  consumables: Consumable[];
  services: { visit_type: string; tier: string; expected: { code: string; quantity: number }[] }[];
  today: string;
  fsm_push: boolean;
}

const listed = async (): Promise<Consumables> => (await request(ops, "/api/consumables")).json<Consumables>();

const TAPE = { name: "Tape strips", unit: "strip", unit_cost: 1200, reorder_kit: 10, reorder_central: 100 };
const SOLVENT = { name: "Solvent", unit: "ml", unit_cost: 50 };

async function add(body: Record<string, unknown>): Promise<Consumables> {
  const answer = await post("/api/consumables", body);
  expect(answer.status).toBe(200);
  return answer.json<Consumables>();
}

const auditFor = (action: string) =>
  env.DB.prepare("SELECT actor, subject_id, detail FROM audit_log WHERE action = ?1 ORDER BY id")
    .bind(action)
    .all<{ actor: string; subject_id: string; detail: string }>();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("the catalogue", () => {
  it("adds a consumable under a code made from its name, offered from now, and not yet read in FSM", async () => {
    const { consumables } = await add(TAPE);

    expect(consumables).toEqual([
      {
        code: "tape_strips",
        name: "Tape strips",
        unit: "strip",
        unit_cost: 1200,
        reorder_kit: 10,
        reorder_central: 100,
        retired_from: null,
        offered: true,
        fsm: { state: "unchecked", item_id: null, name: null },
      },
    ]);
    const [entry] = (await auditFor("consumable.add")).results;
    expect(entry).toMatchObject({ actor: "ops@localhost", subject_id: "tape_strips" });
  });

  it("says the push to FSM is off, so the console can say FSM is set by hand", async () => {
    expect((await listed()).fsm_push).toBe(false);
  });

  it("refuses a second consumable of the same name, whatever its case, and names the field", async () => {
    await add(TAPE);
    const answer = await post("/api/consumables", { ...TAPE, name: "TAPE STRIPS" });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["name"] } });
    expect((await listed()).consumables).toHaveLength(1);
  });

  it("refuses a name that opens as a formula, a cost past its bound, and a unit that is not a word", async () => {
    for (const body of [
      { ...TAPE, name: "=HYPERLINK(1)" },
      { ...TAPE, unit_cost: 10_000_001 },
      { ...TAPE, unit: "1 ml" },
    ]) {
      expect((await post("/api/consumables", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await listed()).consumables).toEqual([]);
  });

  it("renames it and changes its cost, keeping its code, with each before and after audited", async () => {
    await add(TAPE);
    const answer = await post("/api/consumables/tape_strips", { name: "Contour tape", unit_cost: 1500 });

    expect(answer.status).toBe(200);
    const [tape] = (await answer.json<Consumables>()).consumables;
    expect(tape).toMatchObject({ code: "tape_strips", name: "Contour tape", unit_cost: 1500, unit: "strip" });
    const [entry] = (await auditFor("consumable.change")).results;
    expect(JSON.parse(entry?.detail ?? "{}")).toEqual({
      name_from: "Tape strips",
      name_to: "Contour tape",
      unit_cost_from: 1200,
      unit_cost_to: 1500,
    });
  });

  it("clears a reorder level with null, and leaves every field not sent as it was", async () => {
    await add(TAPE);
    await post("/api/consumables/tape_strips", { reorder_kit: null });

    const [tape] = (await listed()).consumables;
    expect(tape).toMatchObject({ reorder_kit: null, reorder_central: 100, name: "Tape strips" });
  });

  it("will not rename one to another's name, and answers 404 for a code nobody added", async () => {
    await add(TAPE);
    await add(SOLVENT);

    const clash = await post("/api/consumables/solvent", { name: "tape strips" });
    expect(clash.status).toBe(400);
    expect(await clash.json()).toMatchObject({ error: { fields: ["name"] } });
    expect((await post("/api/consumables/glue", { unit_cost: 1 })).status).toBe(404);
  });

  it("retires one from a day, still offered until then, and restores it", async () => {
    await add(TAPE);

    const later = await post("/api/consumables/tape_strips/retire", { from: "2026-10-01" });
    expect((await later.json<Consumables>()).consumables[0]).toMatchObject({
      retired_from: "2026-10-01",
      offered: true,
    });

    const today = await post("/api/consumables/tape_strips/retire", { from: "2026-09-21" });
    expect((await today.json<Consumables>()).consumables[0]).toMatchObject({
      retired_from: "2026-09-21",
      offered: false,
    });

    const restored = await post("/api/consumables/tape_strips/restore");
    expect((await restored.json<Consumables>()).consumables[0]).toMatchObject({ retired_from: null, offered: true });
    expect((await auditFor("consumable.retire")).results).toHaveLength(2);
    expect((await auditFor("consumable.restore")).results).toHaveLength(1);
  });

  it("will not retire one from a day gone by", async () => {
    await add(TAPE);
    const answer = await post("/api/consumables/tape_strips/retire", { from: "2026-09-20" });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["from"] } });
  });

  it("says where each stands in FSM's catalogue, as the hourly check last found it", async () => {
    await add(TAPE);
    await add(SOLVENT);
    await add({ name: "Shampoo sachet", unit: "sachet", unit_cost: 800 });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE consumables SET fsm_item_id = 'part-1', fsm_name = 'Tape strips', fsm_checked_at = ?1 WHERE code = 'tape_strips'",
      ).bind("2026-09-21T06:00:00.000Z"),
      env.DB.prepare(
        "UPDATE consumables SET fsm_item_id = 'part-2', fsm_name = 'Solvent (old)', fsm_checked_at = ?1 WHERE code = 'solvent'",
      ).bind("2026-09-21T06:00:00.000Z"),
    ]);

    const states = Object.fromEntries((await listed()).consumables.map((each) => [each.code, each.fsm]));
    expect(states).toEqual({
      tape_strips: { state: "linked", item_id: "part-1", name: "Tape strips" },
      solvent: { state: "renamed", item_id: "part-2", name: "Solvent (old)" },
      shampoo_sachet: { state: "unchecked", item_id: null, name: null },
    });
  });
});

describe("what each service is expected to use", () => {
  it("lists every service the price book prices, the standard four to begin with", async () => {
    const { services } = await listed();
    expect(services.map(({ visit_type, tier }) => `${visit_type}/${tier}`)).toEqual([
      "consultation/standard",
      "first_fit/standard",
      "service/standard",
      "replacement/standard",
    ]);
  });

  it("sets a service's whole list, and a consumable left out next time is expected no more", async () => {
    await add(TAPE);
    await add(SOLVENT);

    const first = await post("/api/service-usage", {
      visit_type: "service",
      tier: "standard",
      items: [
        { code: "tape_strips", quantity: 4 },
        { code: "solvent", quantity: 10 },
      ],
    });
    expect(first.status).toBe(200);
    const service = (await first.json<Consumables>()).services.find((each) => each.visit_type === "service");
    expect(service?.expected).toEqual([
      { code: "solvent", quantity: 10 },
      { code: "tape_strips", quantity: 4 },
    ]);

    await post("/api/service-usage", {
      visit_type: "service",
      tier: "standard",
      items: [{ code: "tape_strips", quantity: 6 }],
    });
    const again = (await listed()).services.find((each) => each.visit_type === "service");
    expect(again?.expected).toEqual([{ code: "tape_strips", quantity: 6 }]);
    expect((await auditFor("consumable.usage")).results.map((entry) => entry.subject_id)).toEqual([
      "service/standard",
      "service/standard",
    ]);
  });

  it("follows a tier the price book prices, and refuses one it does not", async () => {
    await add(TAPE);
    const premium = { visit_type: "first_fit", tier: "premium", items: [{ code: "tape_strips", quantity: 8 }] };

    const refused = await post("/api/service-usage", premium);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["tier"] } });

    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('first_fit', 'premium', 4000000, 0, '2026-10-01')",
    ).run();
    const taken = await post("/api/service-usage", premium);
    expect(taken.status).toBe(200);
    const services = (await taken.json<Consumables>()).services;
    expect(services.find((each) => each.tier === "premium")).toEqual({
      visit_type: "first_fit",
      tier: "premium",
      expected: [{ code: "tape_strips", quantity: 8 }],
    });
  });

  it("refuses a consumable nobody added, and one named twice, by the line", async () => {
    await add(TAPE);
    const answer = await post("/api/service-usage", {
      visit_type: "service",
      tier: "standard",
      items: [
        { code: "tape_strips", quantity: 4 },
        { code: "glue", quantity: 1 },
        { code: "tape_strips", quantity: 2 },
      ],
    });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["items.1.code", "items.2.code"] } });
    expect((await listed()).services.every((each) => each.expected.length === 0)).toBe(true);
  });

  it("refuses a quantity of none, or past what a stepper counts to", async () => {
    await add(TAPE);
    for (const quantity of [0, 1000]) {
      const answer = await post("/api/service-usage", {
        visit_type: "service",
        tier: "standard",
        items: [{ code: "tape_strips", quantity }],
      });
      expect(answer.status, String(quantity)).toBe(400);
    }
  });
});
