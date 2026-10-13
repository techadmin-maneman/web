// The technician's kit (src/routes/tech/kit.ts, src/domain/inventory/kit.ts; docs/decisions/0164-the-kit-screen.md). NOW is
// Monday 21 September 2026, 12 noon in India.
//
// What these hold: a top-up sent to wait for the technician's scan arrives only when they receive it, of the pieces
// they scanned, once; the kit shows what it holds by lot and label, what is coming, and its pieces to hand back, never a
// cost; and handing back marks each returned piece handed in at the kit's place and sends the expired stock there.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, working, type Working } from "../job-fixtures.ts";

let job: Working;
let code: string;

interface Kit {
  held: { code: string; quantity: number; lots: { lot_code: string }[]; units: { code: string }[] }[];
  coming: { id: string; code: string; quantity: number; from: string; units: string[] }[];
  returned: { piece_code: string }[];
}

const kit = async () => (await job.get("/api/tech/kit")).json<Kit>();
const heldOf = async (of: string) => (await kit()).held.find((item) => item.code === of)?.quantity ?? 0;

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  const added = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  code = (await added.json<{ code: string }>()).code;
  await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 2, lot_code: "HS-1" });
});

describe("a top-up that waits for the technician's scan", () => {
  it("arrives only when they receive it, of the pieces scanned, once", async () => {
    const sent = { consumable_code: code, quantity: 2, from: "central", to: IMRAN, wait_for_scan: true };
    expect((await job.opsPost("/api/stock/transfers", sent)).status).toBe(200);
    expect(await heldOf(code)).toBe(0);
    const [coming] = (await kit()).coming;
    expect(coming).toMatchObject({ code, quantity: 2, from: "National warehouse" });
    const [first = "", second = ""] = coming?.units ?? [];

    const received = await job.post(
      `/api/tech/kit/transfers/${coming?.id ?? ""}/receive`,
      { units: [first] },
      "event-kit-01",
    );
    expect(received.status).toBe(200);
    const after = await received.json<Kit>();
    expect(after.held.find((item) => item.code === code)).toMatchObject({ quantity: 1, units: [{ code: first }] });
    expect(after.coming).toEqual([]);
    expect(
      await env.DB.prepare("SELECT state FROM stock_units WHERE code = ?1").bind(second).first<string>("state"),
    ).toBe("missing");

    const again = await job.post(`/api/tech/kit/transfers/${coming?.id ?? ""}/receive`, {}, "event-kit-02");
    expect(again.status).toBe(409);
  });

  it("is no other technician's to receive, and a plain hand-over still arrives at once", async () => {
    await job.opsPost("/api/stock/places", {
      kind: "stockroom",
      name: "Gurgaon stockroom",
      parent_id: "central",
      city: "Gurgaon",
    });
    const room = await env.DB.prepare("SELECT id FROM stock_places WHERE kind = 'stockroom'").first<string>("id");
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 1, from: "central", to: room });
    const elsewhere = await env.DB.prepare("SELECT id FROM stock_transfers").first<string>("id");
    expect((await job.post(`/api/tech/kit/transfers/${elsewhere ?? ""}/receive`, {}, "event-kit-01")).status).toBe(404);

    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 1, from: "central", to: IMRAN });
    expect(await heldOf(code)).toBe(1);
  });
});

describe("the kit", () => {
  it("shows what it holds by lot and label, and never a cost", async () => {
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 2, from: "central", to: IMRAN });
    const response = await job.get("/api/tech/kit");
    const text = await response.clone().text();
    expect(text).not.toContain("cost");
    const [item] = (await response.json<Kit>()).held;
    expect(item).toMatchObject({ code, quantity: 2, lots: [{ lot_code: "HS-1" }] });
    expect(item?.units).toHaveLength(2);
  });
});

describe("handing back", () => {
  it("marks each returned piece handed in at the kit's place, and sends the expired stock there", async () => {
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 2, from: "central", to: IMRAN });
    await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
    await job.opsPost("/api/stock/deliveries", {
      consumable_code: "solvent",
      quantity: 100,
      lot_code: "OLD",
      expires_on: "2026-09-01",
    });
    await job.opsPost("/api/stock/transfers", { consumable_code: "solvent", quantity: 40, from: "central", to: IMRAN });
    const [worn = ""] = (await kit()).held.find((item) => item.code === code)?.units.map((unit) => unit.code) ?? [];
    await env.DB.batch([
      env.DB.prepare("UPDATE stock_units SET state = 'returned' WHERE code = ?1").bind(worn),
      env.DB.prepare(
        `INSERT INTO piece_returns (id, piece_code, appointment_id, technician_id, reason, returned_at)
         VALUES ('pr-1', ?1, ?2, ?3, 'Base lifting', ?4)`,
      ).bind(worn, JOB, IMRAN, NOW.toISOString()),
    ]);
    expect((await kit()).returned).toEqual([
      { piece_code: worn, returned_at: NOW.toISOString(), reason: "Base lifting" },
    ]);

    const refused = await job.post("/api/tech/kit/hand-back", { pieces: ["MM-ESS-9999999-A"] }, "event-kit-01");
    expect(refused.status).toBe(400);

    const handed = await job.post("/api/tech/kit/hand-back", { pieces: [worn], expired: true }, "event-kit-02");
    expect(handed.status).toBe(200);
    const after = await handed.json<Kit>();
    expect(after.returned).toEqual([]);
    expect(after.held.find((item) => item.code === "solvent")).toBeUndefined();
    expect(await env.DB.prepare("SELECT handed_in_to FROM piece_returns").first<string>("handed_in_to")).toBe(
      "central",
    );
    expect(
      await env.DB.prepare("SELECT place FROM stock_units WHERE code = ?1").bind(worn).first<string>("place"),
    ).toBe("central");
    const { results } = await env.DB.prepare(
      "SELECT consumable_code, quantity, to_place, state FROM stock_transfers WHERE from_place = ?1",
    )
      .bind(IMRAN)
      .all();
    expect(results).toEqual([{ consumable_code: "solvent", quantity: 40, to_place: "central", state: "in_transit" }]);
    expect((await request(job.ops, "/api/stock")).status).toBe(200);
  });
});
