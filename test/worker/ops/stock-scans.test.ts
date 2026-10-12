// Scanning labels (src/routes/ops/stock.ts, stock.transit.ts, stock.units.ts; docs/decisions/0162-scanning-labels.md).
// NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a transfer and a loss move the pieces they name, as many as the quantity, and refuse a label the
// place does not hold; a transfer received names the pieces that arrived, and those not named went missing; and a
// label scanned finds its piece, where it is and its history.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";

let job: Working;
let code: string;
let labels: string[];

const labelsAt = async (place: string) =>
  (
    await (
      await request(job.ops, `/api/stock/units?consumable_code=${code}&place_id=${place}`)
    ).json<{ units: { code: string }[] }>()
  ).units
    .map((unit) => unit.code)
    .sort();

const stateOf = async (label: string) =>
  env.DB.prepare("SELECT state FROM stock_units WHERE code = ?1").bind(label).first<string>("state");

const fieldsOf = async (res: Response) =>
  (await res.json<{ error: { code: string; fields?: string[] } }>()).error.fields;

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
  await job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity: 3 });
  labels = await labelsAt("central");
});

describe("a transfer or a loss naming pieces", () => {
  it("moves the pieces named, as many as the quantity, and refuses a label the place does not hold", async () => {
    const [first = "", second = "", third = ""] = labels;
    const transfer = { consumable_code: code, quantity: 1, from: "central", to: IMRAN };
    expect((await job.opsPost("/api/stock/transfers", { ...transfer, units: [third] })).status).toBe(200);
    expect(await labelsAt(IMRAN)).toEqual([third]);

    expect(await fieldsOf(await job.opsPost("/api/stock/transfers", { ...transfer, units: [first, second] }))).toEqual([
      "units",
    ]);
    expect(await fieldsOf(await job.opsPost("/api/stock/transfers", { ...transfer, units: [third] }))).toEqual([
      "units",
    ]);
    await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
    await job.opsPost("/api/stock/deliveries", { consumable_code: "solvent", quantity: 10 });
    const solvent = { ...transfer, consumable_code: "solvent", units: [first] };
    expect(await fieldsOf(await job.opsPost("/api/stock/transfers", solvent))).toEqual(["units"]);

    const lost = { consumable_code: code, place_id: "central", quantity: 1, note: "Base torn", units: [second] };
    expect((await job.opsPost("/api/stock/write-offs", lost)).status).toBe(200);
    expect(await stateOf(second)).toBe("written_off");
    expect(await labelsAt("central")).toEqual([first]);
  });
});

describe("a transfer received naming pieces", () => {
  it("brings the pieces named, and those not named went missing", async () => {
    const added = await job.opsPost("/api/stock/places", {
      kind: "stockroom",
      name: "Gurgaon stockroom",
      parent_id: "central",
      city: "Gurgaon",
    });
    const room =
      (await added.json<{ places: { id: string; name: string }[] }>()).places.find(
        (place) => place.name === "Gurgaon stockroom",
      )?.id ?? "";
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 3, from: "central", to: room });
    const transfer = (await env.DB.prepare("SELECT id FROM stock_transfers").first<string>("id")) ?? "";
    const [first = "", second = "", third = ""] = labels;

    const receive = (body: Record<string, unknown>) => job.opsPost(`/api/stock/transfers/${transfer}/receive`, body);
    expect(await fieldsOf(await receive({ units: [first], received: 2 }))).toEqual(["units"]);
    expect(await fieldsOf(await receive({ units: ["MM-ESS-9999999-A"] }))).toEqual(["units"]);
    expect((await receive({ units: [second, first], note: "One crushed" })).status).toBe(200);
    expect(await labelsAt(room)).toEqual([first, second].sort());
    expect(await stateOf(third)).toBe("missing");
    expect(
      await env.DB.prepare("SELECT received_quantity FROM stock_transfers").first<number>("received_quantity"),
    ).toBe(2);
  });
});

describe("a label scanned", () => {
  it("finds its piece, where it is and its history, typed in any case", async () => {
    const [label = ""] = labels;
    await job.opsPost("/api/stock/transfers", {
      consumable_code: code,
      quantity: 1,
      from: "central",
      to: IMRAN,
      units: [label],
    });
    const found = await request(job.ops, `/api/stock/units/${label.toLowerCase()}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      code: label,
      consumable_code: code,
      state: "held",
      place_id: IMRAN,
      history: [
        { state: "held", place_id: "central" },
        { state: "held", place_id: IMRAN },
      ],
    });
    expect((await request(job.ops, "/api/stock/units/MM-ESS-9999999-A")).status).toBe(404);
  });
});
