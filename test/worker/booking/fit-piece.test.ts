// A fit goes to a technician who can reach its piece (src/domain/booking/occupancy.ts): of those trained to fit in the
// visit's city, only those whose kit, or their city's stockroom, holds a piece of the client's exact spec; and any of
// them where none does, so the fit can still be booked and the evening's kit check tells ops what is short. And ops are
// told at the booking of a fit with no piece of its client's spec in reach, too soon for any supplier to deliver one
// (src/domain/inventory/stock-gap.ts).
// NOW is Monday 21 September 2026, 12 noon in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { techniciansFor } from "../../../src/domain/booking/occupancy.ts";
import { tellOfStockGap } from "../../../src/domain/inventory/stock-gap.ts";
import { NOW, markDatabase } from "../helpers.ts";
import { IMRAN, SAMEER, working, type Working } from "../job-fixtures.ts";
import { pincode } from "../site/consultations-fixtures.ts";

const CLIENT = "88888888-8888-4888-8888-888888888882";

let job: Working;
let code: string;

const offered = async (fitting: { product: string | null } | null) =>
  (await techniciansFor(env.DB, null, { pincode: "122018", personId: CLIENT }, fitting)).map((each) => each.id).sort();

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await pincode("122018", "Sector 65", "Gurgaon", true);
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE technicians SET city = 'Gurgaon', fits_trained = 1"),
    env.DB.prepare(
      `INSERT INTO stock_places (id, kind, name, parent_id, zone, city, created_by, created_at)
       VALUES ('gurgaon-room', 'stockroom', 'Gurgaon stockroom', 'central', NULL, 'Gurgaon', 'test', ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
    ).bind(at),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810088882', 'A client')",
    ).bind(CLIENT, at),
    env.DB.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
         grey_percent, density_percent)
       VALUES ('hp-fit', ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 20, 100)`,
    ).bind(CLIENT, at),
  ]);
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
});

describe("a fit's technician", () => {
  it("is any trained fitter in the city where none can reach a piece of the client's spec", async () => {
    expect(await offered({ product: "essential" })).toEqual([IMRAN, SAMEER].sort());
  });

  it("is one whose kit holds a piece of the client's exact spec, where any does", async () => {
    await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: SAMEER, counted: 1 });
    expect(await offered({ product: "essential" })).toEqual([SAMEER]);
    // A replacement fits the profile's own product; a first fit paid for another is matched to that, which none holds.
    expect(await offered({ product: null })).toEqual([SAMEER]);
    expect(await offered({ product: "natural" })).toEqual([IMRAN, SAMEER].sort());
  });

  it("is any in the city whose stockroom holds one", async () => {
    await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: "gurgaon-room", counted: 1 });
    expect(await offered({ product: "essential" })).toEqual([IMRAN, SAMEER].sort());
  });

  it("is not asked for a visit that fits nothing", async () => {
    await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: SAMEER, counted: 1 });
    expect(await offered(null)).toEqual([IMRAN, SAMEER].sort());
  });
});

describe("a fit booked", () => {
  const told: string[] = [];
  const alertOnce = (alert: { message: string }) => {
    told.push(alert.message);
    return Promise.resolve();
  };
  const fit = (date: string) => ({
    appointmentId: "fit-1",
    personId: CLIENT,
    type: "first_fit",
    tier: "essential",
    date,
    technicianId: IMRAN,
  });
  const supplied = async (leadDays: number) => {
    const added = await job.opsPost("/api/suppliers", {
      name: "Kesh Supplies",
      gstin: null,
      country: "IN",
      currency: "INR",
      contact_name: null,
      contact_phone: null,
      contact_email: null,
      payment_terms_days: 30,
      warranty_days: 90,
    });
    const id = (await added.json<{ suppliers: { id: string }[] }>()).suppliers[0]?.id ?? "";
    await job.opsPost(`/api/suppliers/${id}/items`, {
      consumable_code: code,
      their_code: null,
      unit_price: 1_200_000,
      pack_size: 1,
      minimum_order: 1,
      lead_time_days: leadDays,
    });
  };

  beforeEach(() => {
    told.length = 0;
  });

  it("tells ops when no piece of the client's spec is in reach and no supplier delivers in time", async () => {
    await supplied(14);
    await tellOfStockGap(env.DB, fit("2026-09-24"), { alertOnce, now: NOW });
    expect(told).toEqual([
      "A fit on 2026-09-24 needs Mane Man Essential 8x10 1B, 20% grey, 100%, and none is in Gurgaon or on its way; " +
        "the quickest supplier takes 14 days. Move one there or order now.",
    ]);
  });

  it("says so where no supplier sells it, and says nothing of a client with no profile to match", async () => {
    await tellOfStockGap(env.DB, fit("2026-10-30"), { alertOnce, now: NOW });
    expect(told).toEqual([expect.stringContaining("none is in Gurgaon or on its way; no supplier sells it.")]);
    const noProfile = {
      ...fit("2026-10-30"),
      appointmentId: "fit-2",
      personId: "88888888-8888-4888-8888-888888888889",
    };
    await tellOfStockGap(env.DB, noProfile, { alertOnce, now: NOW });
    expect(told).toHaveLength(1);
  });

  it("says nothing where a supplier delivers before the visit, or a piece is in the city's stockroom", async () => {
    await supplied(3);
    await tellOfStockGap(env.DB, fit("2026-10-05"), { alertOnce, now: NOW });
    await job.opsPost("/api/stock/counts", { consumable_code: code, place_id: "gurgaon-room", counted: 1 });
    await tellOfStockGap(env.DB, fit("2026-09-22"), { alertOnce, now: NOW });
    expect(told).toEqual([]);
  });
});
