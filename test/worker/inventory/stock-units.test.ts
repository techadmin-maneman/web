// Pieces as units (src/domain/inventory/stock-units.ts; docs/decisions/0161-pieces-as-units.md). NOW is Monday 21 September
// 2026, 12 noon in India.
//
// What these hold: a label's check letter catches a digit mistyped or two swapped; a hair system's delivery labels
// each piece in its lot; units follow a transfer soonest to expire first, travel in transit, and those that never
// arrive go missing; a count that finds fewer takes the pieces never labelled first; a loss writes off a unit; pieces
// held before labels are labelled where they are; a piece fitted is the unit its label names, and a correction puts
// it back in the kit; and a lot's label is made once.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { isPieceCode } from "../../../src/config/pieces.ts";
import { labelOf, productSegment } from "../../../src/domain/inventory/stock-units.ts";
import { markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, working, type Working } from "../job-fixtures.ts";

let job: Working;
let code: string;

interface Units {
  units: { code: string; lot_code: string | null; expires_on: string | null }[];
  unlabelled: number;
}

const unitsAt = async (place: string, of = code): Promise<Units> =>
  (await request(job.ops, `/api/stock/units?consumable_code=${of}&place_id=${place}`)).json<Units>();

const labelsAt = async (place: string, of = code) => (await unitsAt(place, of)).units.map((unit) => unit.code).sort();

const stateOf = async (label: string) =>
  env.DB.prepare("SELECT state, place FROM stock_units WHERE code = ?1").bind(label).first<{
    state: string;
    place: string | null;
  }>();

const errorOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

const deliver = (quantity: number, lot: Record<string, string> = {}, of = code) =>
  job.opsPost("/api/stock/deliveries", { consumable_code: of, quantity, ...lot });

async function added(grey = 20): Promise<string> {
  const answer = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: grey,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  expect(answer.status).toBe(200);
  return (await answer.json<{ code: string }>()).code;
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
  code = await added();
});

describe("a label", () => {
  it("passes the label check, and its check letter catches a digit mistyped or two swapped", () => {
    expect(labelOf("STA", 123)).toBe("MM-STA-0000123-J");
    expect(productSegment("standard")).toBe("STA");
    expect(productSegment("lace_front")).toBe("LAC");
    expect(productSegment("a")).toBe("AX");
    for (const serial of [1, 42, 4417, 999_999, 1_234_567]) {
      const label = labelOf("ESS", serial);
      expect(isPieceCode(label)).toBe(true);
      const digits = String(serial).padStart(7, "0");
      for (let at = 0; at < 7; at += 1) {
        for (let digit = 0; digit <= 9; digit += 1) {
          if (String(digit) === digits[at]) continue;
          const typo = Number(digits.slice(0, at) + String(digit) + digits.slice(at + 1));
          expect(labelOf("ESS", typo).slice(-1)).not.toBe(label.slice(-1));
        }
        if (at < 6 && digits[at] !== digits[at + 1]) {
          const swapped = Number(
            digits.slice(0, at) + digits.charAt(at + 1) + digits.charAt(at) + digits.slice(at + 2),
          );
          expect(labelOf("ESS", swapped).slice(-1)).not.toBe(label.slice(-1));
        }
      }
    }
  });
});

describe("a hair system's delivery", () => {
  it("labels each piece in its lot, and a consumable's labels none", async () => {
    await deliver(3, { lot_code: "HS-1", expires_on: "2028-03-31" });
    const { units, unlabelled } = await unitsAt("central");
    expect(unlabelled).toBe(0);
    expect(units).toHaveLength(3);
    expect(new Set(units.map((unit) => unit.code)).size).toBe(3);
    for (const unit of units) {
      expect(unit.code).toMatch(/^MM-ESS-\d{7}-[A-Z]$/);
      expect(unit).toMatchObject({ lot_code: "HS-1", expires_on: "2028-03-31" });
    }

    expect((await errorOf(await deliver(501))).fields).toEqual(["quantity"]);
    await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
    const solvent = await request(job.ops, "/api/stock/units?consumable_code=solvent&place_id=central");
    expect((await errorOf(solvent)).fields).toEqual(["consumable_code"]);
  });
});

describe("units moved", () => {
  beforeEach(async () => {
    await deliver(2, { lot_code: "LATE", expires_on: "2028-06-30" });
    await deliver(2, { lot_code: "SOON", expires_on: "2027-06-30" });
  });

  it("follow a transfer to a kit, soonest to expire first", async () => {
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 3, from: "central", to: IMRAN });
    const kit = await unitsAt(IMRAN);
    expect(kit.units.map((unit) => unit.lot_code).sort()).toEqual(["LATE", "SOON", "SOON"]);
    expect((await unitsAt("central")).units.map((unit) => unit.lot_code)).toEqual(["LATE"]);
  });

  it("move once when two moves name one label together, and the second is refused, writing nothing", async () => {
    const [label = ""] = await labelsAt("central");
    const move = (to: string) =>
      job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 1, from: "central", to, units: [label] });
    const answers = await Promise.all([move(IMRAN), move(IMRAN)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 400]);
    expect(await stateOf(label)).toEqual({ state: "held", place: IMRAN });
    expect(await labelsAt(IMRAN)).toEqual([label]);
    const moved = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM stock_movements WHERE reason = 'transferred'",
    ).first();
    expect(moved).toEqual({ n: 2 });

    // Named again from where it no longer is, it is refused too.
    expect((await move(IMRAN)).status).toBe(400);
    expect(await labelsAt("central")).toHaveLength(3);
  });

  it("travel in transit to a stockroom, and those that never arrive go missing", async () => {
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
    const before = await labelsAt("central");
    await job.opsPost("/api/stock/transfers", { consumable_code: code, quantity: 3, from: "central", to: room });
    expect(await labelsAt("central")).toHaveLength(1);
    expect(await labelsAt(room)).toEqual([]);

    const transfer = await env.DB.prepare("SELECT id FROM stock_transfers").first<string>("id");
    await job.opsPost(`/api/stock/transfers/${transfer ?? ""}/receive`, { received: 2, note: "One crushed" });
    const arrived = await labelsAt(room);
    expect(arrived).toHaveLength(2);
    const left = await labelsAt("central");
    const lost = before.filter((label) => !arrived.includes(label) && !left.includes(label));
    expect(await Promise.all(lost.map(stateOf))).toEqual([{ state: "missing", place: null }]);
  });

  it("go missing where a count finds fewer, pieces never labelled first; and a loss writes one off", async () => {
    await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: "central", counted: 6 });
    expect(await unitsAt("central")).toMatchObject({ unlabelled: 2 });
    await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: "central", counted: 3 });
    const counted = await unitsAt("central");
    expect(counted.unlabelled).toBe(0);
    expect(counted.units).toHaveLength(3);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM stock_units WHERE state = 'missing'").first<number>("n"),
    ).toBe(1);

    await job.opsPost("/api/stock/write-offs", {
      consumable_code: code,
      place_id: "central",
      quantity: 1,
      note: "Base torn",
    });
    expect((await unitsAt("central")).units.map((unit) => unit.lot_code)).toEqual(["LATE", "LATE"]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM stock_units WHERE state = 'written_off'").first<number>("n"),
    ).toBe(1);
  });
});

describe("pieces held before labels", () => {
  it("are labelled where they are, up to the number asked", async () => {
    await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: IMRAN, counted: 3 });
    expect(await unitsAt(IMRAN)).toMatchObject({ units: [], unlabelled: 3 });
    const labelled = await job.opsPost("/api/stock/units", { consumable_code: code, place_id: IMRAN, quantity: 2 });
    expect(labelled.status).toBe(200);
    const answer = await labelled.json<Units>();
    expect(answer.unlabelled).toBe(1);
    expect(answer.units).toHaveLength(2);
    expect(answer.units.every((unit) => isPieceCode(unit.code))).toBe(true);
  });
});

describe("a piece fitted", () => {
  it("is the unit its label names, and a correction puts it back in the kit", async () => {
    const second = await added(30);
    for (const each of [code, second]) {
      await deliver(2, {}, each);
      await job.opsPost("/api/stock/transfers", { consumable_code: each, quantity: 2, from: "central", to: IMRAN });
    }
    const [fitted, kept] = await labelsAt(IMRAN);
    await job.workTo("consumables");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [], short_reason: "other" }, "event-consumables-01");

    await job.post(`/api/tech/jobs/${JOB}/piece`, { piece_code: fitted, stock_code: code }, "event-piece-01");
    expect(await stateOf(fitted ?? "")).toEqual({ state: "fitted", place: null });
    expect(await labelsAt(IMRAN)).toEqual([kept]);

    // Another stock code under a label we never made: the first piece goes back, and one of the other's goes missing.
    await job.post(
      `/api/tech/jobs/${JOB}/piece`,
      { piece_code: "MM-STD-4417-B", stock_code: second },
      "event-piece-02",
    );
    expect(await stateOf(fitted ?? "")).toEqual({ state: "held", place: IMRAN });
    expect(await labelsAt(IMRAN, second)).toHaveLength(1);
    const history = await env.DB.prepare(
      `SELECT e.state FROM stock_unit_events e JOIN stock_units u ON u.id = e.unit_id WHERE u.code = ?1
       ORDER BY e.at, e.rowid`,
    )
      .bind(fitted)
      .all<{ state: string }>();
    expect(history.results.map((row) => row.state)).toEqual(["held", "held", "fitted", "held"]);
  });
});

describe("a lot's label", () => {
  it("is made the first time it is asked for, and stays the same", async () => {
    await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
    await deliver(100, { lot_code: "SV-1" }, "solvent");
    const lot = await env.DB.prepare("SELECT id FROM stock_lots WHERE lot_code = 'SV-1'").first<string>("id");
    const first = await (await job.opsPost(`/api/stock/lots/${lot ?? ""}/label`, {})).json<{ label: string }>();
    expect(first.label).toBe(labelOf("LT", 1));
    const again = await (await job.opsPost(`/api/stock/lots/${lot ?? ""}/label`, {})).json<{ label: string }>();
    expect(again.label).toBe(first.label);
    expect((await job.opsPost("/api/stock/lots/nothing/label", {})).status).toBe(404);
  });
});
