// Lots and expiry (src/domain/inventory/stock-lots.ts; docs/decisions/0157-lots-and-expiry.md). NOW is Monday 21 September
// 2026, 12 noon in India.
//
// What these hold: a delivery brings a lot, named by the supplier or by its day, expiring when the supplier says or
// after the stock code's shelf life; what leaves a place leaves from the lot that expires soonest, and arrives at the
// other place of the same lots; a job's use comes from the kit's soonest lot, and a correction gives back to the lot
// it took from; a count down takes the soonest lot and a count up adds stock of no known lot; and a loss can name the
// lot it was, as one that expired.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { IMRAN, JOB, working, type Working } from "../job-fixtures.ts";

let job: Working;

interface Lot {
  id: string;
  lot_code: string;
  expires_on: string | null;
  quantity: number;
}

const lotsAt = async (place: string, code = "solvent"): Promise<Omit<Lot, "id">[]> => {
  const book = await (
    await request(job.ops, "/api/stock")
  ).json<{
    holdings: { consumable_code: string; place_id: string; lots: Lot[] }[];
  }>();
  const holding = book.holdings.find((each) => each.consumable_code === code && each.place_id === place);
  return (holding?.lots ?? []).map(({ lot_code, expires_on, quantity }) => ({ lot_code, expires_on, quantity }));
};

const deliver = (quantity: number, lot: Record<string, string> = {}, code = "solvent") =>
  job.opsPost("/api/stock/deliveries", { consumable_code: code, quantity, ...lot });

const errorOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

beforeEach(async () => {
  await markDatabase();
  job = await working();
  for (const consumable of [
    { name: "Solvent", unit: "ml", unit_cost: 50, shelf_life_days: 180 },
    { name: "Tape strips", unit: "strip", unit_cost: 1200 },
  ]) {
    expect((await job.opsPost("/api/consumables", consumable)).status).toBe(200);
  }
});

describe("a delivery", () => {
  it("brings the lot the supplier names, or one named for its day that expires after the shelf life", async () => {
    await deliver(300, { lot_code: "SV-2611", expires_on: "2026-11-30" });
    await deliver(200);
    expect(await lotsAt("central")).toEqual([
      { lot_code: "SV-2611", expires_on: "2026-11-30", quantity: 300 },
      { lot_code: "R-20260921", expires_on: "2027-03-20", quantity: 200 },
    ]);

    await deliver(50, {}, "tape_strips");
    expect(await lotsAt("central", "tape_strips")).toEqual([]);
  });
});

describe("what leaves a place", () => {
  beforeEach(async () => {
    await deliver(100, { lot_code: "LATE", expires_on: "2027-06-30" });
    await deliver(100, { lot_code: "SOON", expires_on: "2026-10-31" });
  });

  it("leaves from the lot that expires soonest, and arrives of the same lots", async () => {
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "solvent",
      quantity: 150,
      from: "central",
      to: IMRAN,
    });
    expect(await lotsAt("central")).toEqual([{ lot_code: "LATE", expires_on: "2027-06-30", quantity: 50 }]);
    expect(await lotsAt(IMRAN)).toEqual([
      { lot_code: "SOON", expires_on: "2026-10-31", quantity: 100 },
      { lot_code: "LATE", expires_on: "2027-06-30", quantity: 50 },
    ]);
  });

  it("takes a job's use from the kit's soonest lot, and gives a correction back to the lot it took from", async () => {
    await job.opsPost("/api/stock/transfers", {
      consumable_code: "solvent",
      quantity: 150,
      from: "central",
      to: IMRAN,
    });
    await job.workTo("consumables");
    const step = (quantity: number, eventId: string) =>
      job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [{ code: "solvent", quantity }] }, eventId);
    await step(120, "event-consumables-01");
    expect(await lotsAt(IMRAN)).toEqual([{ lot_code: "LATE", expires_on: "2027-06-30", quantity: 30 }]);

    await step(90, "event-consumables-02");
    expect(await lotsAt(IMRAN)).toEqual([
      { lot_code: "SOON", expires_on: "2026-10-31", quantity: 10 },
      { lot_code: "LATE", expires_on: "2027-06-30", quantity: 50 },
    ]);
  });

  it("takes a count down from the soonest lot, and adds a count up as stock of no known lot", async () => {
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: "central", counted: 170 });
    expect(await lotsAt("central")).toEqual([
      { lot_code: "SOON", expires_on: "2026-10-31", quantity: 70 },
      { lot_code: "LATE", expires_on: "2027-06-30", quantity: 100 },
    ]);
    await job.opsPost("/api/stock/counts", { consumable_code: "solvent", place_id: "central", counted: 200 });
    const total = (await lotsAt("central")).reduce((sum, lot) => sum + lot.quantity, 0);
    expect(total).toBe(170);
  });

  it("writes off the lot named, as one that expired, and refuses a lot the place holds none of", async () => {
    const book = await (
      await request(job.ops, "/api/stock")
    ).json<{
      holdings: { consumable_code: string; place_id: string; lots: Lot[] }[];
    }>();
    const late = book.holdings
      .find((each) => each.consumable_code === "solvent" && each.place_id === "central")
      ?.lots.find((lot) => lot.lot_code === "LATE");
    const lost = { consumable_code: "solvent", place_id: "central", quantity: 40, note: "Spoilt in the heat" };
    expect((await job.opsPost("/api/stock/write-offs", { ...lost, lot_id: late?.id })).status).toBe(200);
    expect(await lotsAt("central")).toEqual([
      { lot_code: "SOON", expires_on: "2026-10-31", quantity: 100 },
      { lot_code: "LATE", expires_on: "2027-06-30", quantity: 60 },
    ]);

    const refused = await job.opsPost("/api/stock/write-offs", { ...lost, place_id: IMRAN, lot_id: late?.id });
    expect((await errorOf(refused)).fields).toEqual(["lot_id"]);
  });
});

describe("a stock code's shelf life", () => {
  it("is set and changed in Settings, and the change audited", async () => {
    const changed = await job.opsPost("/api/consumables/tape_strips", { shelf_life_days: 365 });
    const body = await changed.json<{ consumables: { code: string; shelf_life_days: number | null }[] }>();
    expect(body.consumables.find((each) => each.code === "tape_strips")?.shelf_life_days).toBe(365);
    const audit = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'consumable.change'").first();
    expect(JSON.parse(String(audit?.detail))).toEqual({ shelf_life_from: -1, shelf_life_to: 365 });
  });
});
