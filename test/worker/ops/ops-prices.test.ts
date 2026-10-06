// The business inputs ops set for themselves, on the ops surface
// (src/routes/ops/settings.ts, docs/decisions/0061-ops-editable-inputs.md). NOW
// is Monday 21 September 2026, 12 noon in India. Every pincode here is real
// only as a number; nothing is a person, a mobile or an address.
//
// What these hold: an empty store behaves as the committed code does, a change
// reaches the routes that read it without a deploy, a figure outside the bounds
// never lands, every change is recorded under the Access identity behind it,
// and neither ops nor a file can leave the business with nowhere to go.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { lateFeeOn } from "../../../src/domain/money/price-book.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";

let ops: App;

const post = (path: string, body: unknown, bindings: Partial<Env> = {}) =>
  request(ops, path, { method: "POST", headers: POST, body: JSON.stringify(body) }, bindings);

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("the price book", () => {
  it("marks the one row that applies today, and leaves the rest past or still to come", async () => {
    await post("/api/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2026-10-01",
    });
    const body = await (
      await request(ops, "/api/prices")
    ).json<{ prices: { item: string; valid_from: string; in_force: boolean }[] }>();
    const service = body.prices.filter((price) => price.item === "service");
    // The seeded rows are migrations 0016 (from January) and 0018 (from the 22nd),
    // and today is the 21st, so January's is what is charged and the other two are not.
    expect(service.filter((price) => price.in_force).map((price) => price.valid_from)).toEqual(["2026-01-01"]);
    expect(service.map((price) => price.valid_from)).toEqual(["2026-10-01", "2026-09-22", "2026-01-01"]);
  });

  // A row nothing reads is a price nobody is charged.
  it("refuses an item the book does not price", async () => {
    const answer = await post("/api/prices", {
      item: "consultaton",
      tier: "standard",
      amount_ex_gst: 50_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["item"] } });
  });

  it("refuses a price dated before today, since a visit was invoiced under the old one", async () => {
    const answer = await post("/api/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2026-09-01",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["valid_from"] } });
  });

  // A price from today changed what a client had been quoted that day.
  it("takes a new price from tomorrow at the earliest, and leaves today's as it was", async () => {
    const change = { item: "late_fee_first_fit", tier: "standard", amount_ex_gst: 600_000, gst_percent: 0 };
    const today = await post("/api/prices", { ...change, valid_from: "2026-09-21" });
    expect(today.status).toBe(400);
    expect(await today.json()).toMatchObject({ error: { code: "invalid_request", fields: ["valid_from"] } });
    expect((await auditFor("price.set")).results).toHaveLength(0);

    expect((await post("/api/prices", { ...change, valid_from: "2026-09-22" })).status).toBe(200);
    expect(await lateFeeOn(env.DB, "late_fee_first_fit", "2026-09-21")).toMatchObject({ amount_ex_gst: 400_000 });
    expect(await lateFeeOn(env.DB, "late_fee_first_fit", "2026-09-22")).toMatchObject({ amount_ex_gst: 600_000 });
  });

  it("refuses part of a rupee, and a rate no GST slab reaches", async () => {
    const base = { item: "service", tier: "standard", gst_percent: 0, valid_from: "2026-09-22" };
    const partRupee = await post("/api/prices", { ...base, amount_ex_gst: 250_050 });
    expect(await partRupee.json()).toMatchObject({ error: { fields: ["amount_ex_gst"] } });
    const noSlab = await post("/api/prices", { ...base, amount_ex_gst: 250_000, gst_percent: 40 });
    expect(await noSlab.json()).toMatchObject({ error: { fields: ["gst_percent"] } });
  });

  // A tier is a service now, added in the console before it is priced (docs/decisions/0085-services-ops-can-edit.md).
  it("prices a service ops added to a kind, which is how a new kind of base is priced", async () => {
    expect((await post("/api/services", { kind: "first_fit", name: "Lace" })).status).toBe(201);
    const answer = await post("/api/prices", {
      item: "first_fit",
      tier: "lace",
      amount_ex_gst: 4_000_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    expect(answer.status).toBe(200);
    const body = await answer.json<{ prices: { item: string; tier: string; amount_ex_gst: number }[] }>();
    expect(body.prices).toContainEqual(
      expect.objectContaining({ item: "first_fit", tier: "lace", amount_ex_gst: 4_000_000 }),
    );
  });

  // A price for a tier no service carries is a price nobody could ever be sold.
  it("refuses a tier no service of the kind carries, and names the box", async () => {
    const answer = await post("/api/prices", {
      item: "first_fit",
      tier: "lace",
      amount_ex_gst: 4_000_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["tier"] } });
    expect((await auditFor("price.set")).results).toHaveLength(0);
  });

  it("keeps a late fee to one figure a kind, its standard tier's", async () => {
    const fee = { item: "late_fee_first_fit", amount_ex_gst: 500_000, gst_percent: 0, valid_from: "2026-09-22" };
    expect((await post("/api/prices", { ...fee, tier: "standard" })).status).toBe(200);
    const answer = await post("/api/prices", { ...fee, tier: "premium" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { fields: ["tier"] } });
  });

  it("records who set it, from what and from when", async () => {
    await post("/api/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2026-10-01",
    });
    const { results } = await auditFor("price.set");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "service/standard" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      from: 200_000,
      to: 250_000,
      gst_percent: 0,
      valid_from: "2026-10-01",
    });
  });

  // The first price of a service once was recorded as from -1.
  it("records from as null where the book had no price for it", async () => {
    await post("/api/services", { kind: "first_fit", name: "Lace" });
    await post("/api/prices", {
      item: "first_fit",
      tier: "lace",
      amount_ex_gst: 4_000_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
    });
    const { results } = await auditFor("price.set");
    expect(JSON.parse(results[0]?.detail ?? "{}")).toMatchObject({ from: null, to: 4_000_000 });
  });
});

// A price set for a day still to come is a decision somebody has to be able to take back before it lands.
describe("withdrawing a price still to come", () => {
  const OCTOBER = {
    item: "service",
    tier: "standard",
    amount_ex_gst: 250_000,
    gst_percent: 18,
    valid_from: "2026-10-01",
  };
  const withdraw = (row: { item: string; tier: string; valid_from: string }) => post("/api/prices/withdraw", row);
  const serviceRows = async () =>
    (await (await request(ops, "/api/prices")).json<{ prices: { item: string; valid_from: string }[] }>()).prices
      .filter((price) => price.item === "service")
      .map((price) => price.valid_from);

  it("takes the row out of the book, so the price before it goes on applying", async () => {
    await post("/api/prices", OCTOBER);
    const answer = await withdraw({ item: "service", tier: "standard", valid_from: "2026-10-01" });
    expect(answer.status).toBe(200);
    expect(await serviceRows()).toEqual(["2026-09-22", "2026-01-01"]);
  });

  it("records who withdrew it, and what it would have been", async () => {
    await post("/api/prices", OCTOBER);
    await withdraw({ item: "service", tier: "standard", valid_from: "2026-10-01" });
    const { results } = await auditFor("price.withdraw");
    expect(results[0]).toMatchObject({ actor: "ops@localhost", subject_id: "service/standard" });
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      amount_ex_gst: 250_000,
      gst_percent: 18,
      valid_from: "2026-10-01",
    });
  });

  it("refuses the price in force and a spent one, since a visit may have been invoiced under either", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('service', 'standard', 250000, 18, '2026-09-21')",
    ).run();
    for (const validFrom of ["2026-01-01", "2026-09-21"]) {
      const answer = await withdraw({ item: "service", tier: "standard", valid_from: validFrom });
      expect(answer.status, validFrom).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["valid_from"] } });
    }
    expect((await auditFor("price.withdraw")).results).toHaveLength(0);
  });

  it("answers not_found for a row the book does not hold", async () => {
    expect((await withdraw({ item: "service", tier: "standard", valid_from: "2026-12-01" })).status).toBe(404);
  });
});
