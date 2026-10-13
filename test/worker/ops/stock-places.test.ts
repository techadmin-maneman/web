// The places stock is kept, as a tree (src/routes/ops/stock.places.ts, src/domain/field/stock-places.ts;
// docs/decisions/0155-the-stock-place-tree.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a hub hangs from the warehouse and a stockroom from either, and a kit from any of them; stock moves
// into and out of a stockroom as it does a kit, its rows naming it; a place is renamed or moved, and closed only once
// it is empty with nothing open under it; a stockroom low on anything raises its own alert, by its name; and a
// technician deleted as added by mistake goes with their kit.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { IMRAN, SAMEER, working, type Working } from "../job-fixtures.ts";
import { type Stock } from "./stock-fixtures.ts";

let job: Working;

const stock = async (): Promise<Stock> => (await request(job.ops, "/api/stock")).json<Stock>();

const errorOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

/** Adds a place, answering its ID. */
async function added(place: Record<string, string>): Promise<string> {
  const answer = await job.opsPost("/api/stock/places", place);
  expect(answer.status).toBe(200);
  const found = (await answer.json<Stock>()).places.find((each) => each.name === place.name);
  return found?.id ?? "";
}

const room = () => added({ kind: "stockroom", name: "Gurgaon stockroom", parent_id: "central", city: "Gurgaon" });

const change = (id: string, body: Record<string, unknown>) => job.opsPost(`/api/stock/places/${id}`, body);

/** Sends stock from one place to another, and receives it there where it went in transit. */
async function sendAndReceive(quantity: number, from: string, to: string): Promise<void> {
  const answer = await job.opsPost("/api/stock/transfers", { consumable_code: "tape_strips", quantity, from, to });
  const { in_transit } = await answer.json<{ in_transit: { id: string }[] }>();
  for (const transfer of in_transit) await job.opsPost(`/api/stock/transfers/${transfer.id}/receive`, {});
}

const heldAt = async (place: string) =>
  (await stock()).holdings.find((each) => each.consumable_code === "tape_strips" && each.place_id === place);

beforeEach(async () => {
  await markDatabase();
  job = await working();
  const consumable = {
    name: "Tape strips",
    unit: "strip",
    unit_cost: 1200,
    reorder_kit: 5,
    reorder_store: 20,
    reorder_central: 10,
  };
  expect((await job.opsPost("/api/consumables", consumable)).status).toBe(200);
  await job.opsPost("/api/stock/deliveries", { consumable_code: "tape_strips", quantity: 100 });
});

describe("the tree", () => {
  it("adds a stockroom under the warehouse, and moves stock into it, each row naming it", async () => {
    const id = await room();
    expect((await stock()).places.find((place) => place.id === id)).toEqual({
      id,
      kind: "stockroom",
      name: "Gurgaon stockroom",
      parent_id: "central",
      zone: "NCR",
      city: "Gurgaon",
      active: true,
    });

    await sendAndReceive(40, "central", id);
    expect(await heldAt(id)).toMatchObject({ quantity: 40, low: false });
    expect(await heldAt("central")).toMatchObject({ quantity: 60 });
    const rows = await env.DB.prepare(
      "SELECT location, technician_id, quantity FROM stock_movements WHERE place_id = ?1",
    )
      .bind(id)
      .all();
    expect(rows.results).toEqual([{ location: "central", technician_id: null, quantity: 40 }]);
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'stock.place_add'").first();
    expect(JSON.parse(String(audit?.detail))).toEqual({ kind: "stockroom", parent_id: "central", area: "Gurgaon" });
  });

  it("refuses a name another place has, a place under a kit, and a city we do not have", async () => {
    await room();
    const twice = await job.opsPost("/api/stock/places", {
      kind: "stockroom",
      name: "gurgaon STOCKROOM",
      parent_id: IMRAN,
      city: "Atlantis",
    });
    expect(twice.status).toBe(400);
    expect((await errorOf(twice)).fields).toEqual(["name", "parent_id", "city"]);
  });

  it("hangs a hub from the warehouse only, and moves a kit under a stockroom, still named by its technician", async () => {
    const hub = await added({ kind: "hub", name: "North hub", parent_id: "central", zone: "NCR" });
    const underHub = await added({ kind: "stockroom", name: "Delhi stockroom", parent_id: hub, city: "Delhi" });
    const refused = await job.opsPost("/api/stock/places", {
      kind: "hub",
      name: "Second hub",
      parent_id: underHub,
      zone: "NCR",
    });
    expect((await errorOf(refused)).fields).toEqual(["parent_id"]);

    expect((await change(IMRAN, { parent_id: underHub })).status).toBe(200);
    const kit = (await stock()).places.find((place) => place.id === IMRAN);
    expect(kit).toMatchObject({ kind: "kit", name: "Imran Qureshi", parent_id: underHub });
    expect((await errorOf(await change(IMRAN, { name: "Imran's bag" }))).fields).toEqual(["name"]);
    expect((await errorOf(await change("central", { parent_id: hub }))).fields).toEqual(["parent_id"]);
    expect((await change("central", { name: "Main warehouse" })).status).toBe(200);
    expect((await stock()).places[0]).toMatchObject({ id: "central", name: "Main warehouse" });
  });

  it("closes a stockroom only once it is empty and nothing open is under it, and opens it again", async () => {
    const id = await room();
    await sendAndReceive(5, "central", id);
    await change(SAMEER, { parent_id: id });
    expect((await errorOf(await change(id, { active: false }))).fields).toEqual(["active"]);

    await sendAndReceive(5, id, "central");
    expect((await errorOf(await change(id, { active: false }))).fields).toEqual(["active"]);
    await change(SAMEER, { parent_id: "central" });
    expect((await change(id, { active: false })).status).toBe(200);
    expect((await stock()).places.map((place) => place.id)).not.toContain(id);
    expect((await errorOf(await change(SAMEER, { parent_id: id }))).fields).toEqual(["parent_id"]);

    expect((await change(id, { active: true })).status).toBe(200);
    expect((await stock()).places.find((place) => place.id === id)?.active).toBe(true);
    expect((await errorOf(await change("central", { active: false }))).fields).toEqual(["active"]);
  });

  it("answers not found for a place nobody added", async () => {
    const answer = await change("no-such-place", { name: "Anywhere" });
    expect(answer.status).toBe(404);
  });
});

describe("a stockroom's stock", () => {
  it("raises its own alert at the stores' level, by its name, and closes it once stocked again", async () => {
    const id = await room();
    await sendAndReceive(30, "central", id);
    await job.opsPost("/api/stock/write-offs", {
      consumable_code: "tape_strips",
      place_id: id,
      quantity: 15,
      note: "Water damage",
    });
    expect(await heldAt(id)).toMatchObject({ quantity: 15, low: true });
    expect(job.deps.alerts).toEqual([
      expect.stringContaining("Tape strips is low in Gurgaon stockroom: 15 strip, at or below its level of 20."),
    ]);

    await sendAndReceive(10, "central", id);
    const alert = await env.DB.prepare("SELECT resolved_at FROM alerts WHERE key = ?1")
      .bind(`low_stock:store:${id}:tape_strips`)
      .first<{ resolved_at: string | null }>();
    expect(alert?.resolved_at).not.toBeNull();
  });
});

describe("a technician's kit", () => {
  it("comes with them, and goes with them when they are deleted as added by mistake", async () => {
    const newcomer = "33333333-3333-4333-8333-333333333339";
    await env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, city, mobile_e164, updated_at)
       VALUES (?1, ?1, 'Vikram Rana', 'VR', 1, 'Gurgaon', '+919810000107', '2026-09-21T06:30:00.000Z')`,
    )
      .bind(newcomer)
      .run();
    expect((await stock()).places.find((place) => place.id === newcomer)).toMatchObject({
      kind: "kit",
      name: "Vikram Rana",
      parent_id: "central",
    });

    expect((await job.opsPost(`/api/technicians/${newcomer}/delete`)).status).toBe(200);
    const kit = await env.DB.prepare("SELECT 1 FROM stock_places WHERE id = ?1").bind(newcomer).first();
    expect(kit).toBeNull();
  });

  // The code before the place tree deletes a technician without knowing of kits.
  it("leaves out a kit whose technician was deleted without it", async () => {
    await env.DB.prepare("DELETE FROM technicians WHERE id = ?1").bind(SAMEER).run();
    expect((await stock()).places.map((place) => place.id)).not.toContain(SAMEER);
    const moved = await job.opsPost("/api/stock/transfers", {
      consumable_code: "tape_strips",
      quantity: 1,
      from: "central",
      to: SAMEER,
    });
    expect((await errorOf(moved)).fields).toEqual(["to"]);
  });
});
