// Transfers in transit (src/domain/inventory/stock-transit.ts; docs/decisions/0158-transfers-in-transit.md). NOW is Monday
// 21 September 2026, 12 noon in India.
//
// What these hold: stock sent to a stockroom leaves its place at once and arrives when received, of the same lots, in
// full or short; one sent back returns where it left; a transfer is settled once, however many settle it at once; a
// kit is handed stock at once, as before; and receiving keeps to the caller's cities at the place it went to.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { IMRAN, working, type Working } from "../job-fixtures.ts";

let job: Working;
let room: string;

interface Book {
  holdings: {
    consumable_code: string;
    place_id: string;
    quantity: number;
    lots: { lot_code: string; quantity: number }[];
  }[];
  in_transit: { id: string; consumable_code: string; quantity: number; from: string; to: string }[];
}

const book = async (): Promise<Book> => (await request(job.ops, "/api/stock")).json<Book>();
const heldAt = async (place: string) =>
  (await book()).holdings.find((each) => each.consumable_code === "solvent" && each.place_id === place);

const send = async (quantity: number, from: string, to: string): Promise<string> => {
  const answer = await job.opsPost("/api/stock/transfers", { consumable_code: "solvent", quantity, from, to });
  expect(answer.status).toBe(200);
  return (await answer.json<Book>()).in_transit.at(-1)?.id ?? "";
};

const errorOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await job.opsPost("/api/stock/deliveries", {
    consumable_code: "solvent",
    quantity: 500,
    lot_code: "SV-1",
    expires_on: "2027-01-31",
  });
  const added = await job.opsPost("/api/stock/places", {
    kind: "stockroom",
    name: "Gurgaon stockroom",
    parent_id: "central",
    city: "Gurgaon",
  });
  room =
    (await added.json<{ places: { id: string; name: string }[] }>()).places.find(
      (place) => place.name === "Gurgaon stockroom",
    )?.id ?? "";
});

describe("a transfer to a stockroom", () => {
  it("leaves at once, is in transit, and arrives of the same lots when received", async () => {
    const id = await send(200, "central", room);
    expect(await heldAt("central")).toMatchObject({ quantity: 300 });
    expect((await heldAt(room))?.quantity ?? 0).toBe(0);
    expect((await book()).in_transit).toEqual([
      {
        id,
        consumable_code: "solvent",
        quantity: 200,
        from: "central",
        to: room,
        sent_at: expect.any(String) as string,
        sent_by: "ops@localhost",
      },
    ]);

    expect((await job.opsPost(`/api/stock/transfers/${id}/receive`, {})).status).toBe(200);
    expect(await heldAt(room)).toMatchObject({ quantity: 200, lots: [{ lot_code: "SV-1", quantity: 200 }] });
    expect((await book()).in_transit).toEqual([]);
  });

  it("is received short, what was lost on the way recorded with ops' words", async () => {
    const id = await send(200, "central", room);
    await job.opsPost(`/api/stock/transfers/${id}/receive`, { received: 180, note: "One carton crushed" });
    expect(await heldAt(room)).toMatchObject({ quantity: 180, lots: [{ lot_code: "SV-1", quantity: 180 }] });
    const row = await env.DB.prepare("SELECT state, received_quantity, note FROM stock_transfers WHERE id = ?1")
      .bind(id)
      .first();
    expect(row).toEqual({ state: "received", received_quantity: 180, note: "One carton crushed" });

    const more = await job.opsPost(`/api/stock/transfers/${await send(10, "central", room)}/receive`, { received: 11 });
    expect((await errorOf(more)).fields).toEqual(["received"]);
  });

  it("returns where it left when sent back, and is settled once however many settle it at once", async () => {
    const id = await send(200, "central", room);
    const answers = await Promise.all([
      job.opsPost(`/api/stock/transfers/${id}/send-back`),
      job.opsPost(`/api/stock/transfers/${id}/receive`, {}),
    ]);
    const codes = await Promise.all(
      answers.map(async (answer) => (answer.status === 200 ? "ok" : (await errorOf(answer)).code)),
    );
    expect(codes.sort()).toEqual(["ok", "transfer_settled"]);
    const total = ((await heldAt("central"))?.quantity ?? 0) + ((await heldAt(room))?.quantity ?? 0);
    expect(total).toBe(500);
  });

  it("hands stock to a kit at once, as before", async () => {
    await send(50, "central", IMRAN);
    expect(await heldAt(IMRAN)).toMatchObject({ quantity: 50 });
    expect((await book()).in_transit).toEqual([]);
  });
});
