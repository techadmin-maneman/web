// Our cities as data (src/routes/ops/cities.ts, docs/decisions/0198-cities-as-data.md): a city added and renamed in the
// console, each with its state for GST, the rules and prices a city sets apart, and the GST registration a state's
// visits are supplied from. NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NO_GST } from "../../../src/config/gst.ts";
import { cityRules, inputsIn, reminderHourCame } from "../../../src/domain/cities/city-rules.ts";
import { supplyFor } from "../../../src/domain/cities/gst-registrations.ts";
import { workableJob } from "../../../src/domain/field/workable-job.ts";
import { priceOf } from "../../../src/domain/money/price-book.ts";
import { COMMITTED } from "../../../src/domain/platform/ops-settings.ts";
import type { App } from "../../../src/http/context.ts";
import { aTechnician, aVisit } from "../fixtures/index.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";

let ops: App;

const send = (method: string, path: string, body?: unknown) =>
  request(ops, path, { method, headers: POST, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const PUNE = { name: "Pune", state_code: "MH", state: "Maharashtra", zone: null, served: false, active: true };

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("a city", () => {
  it("is listed with its state, its zone and whether we serve it", async () => {
    const body = await (await request(ops, "/api/cities")).json<{ cities: { name: string; state_code: string }[] }>();
    expect(body.cities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Gurgaon", state_code: "HR", state: "Haryana", zone: "NCR", served: true }),
        expect.objectContaining({ name: "Mumbai", state_code: "MH", served: false }),
      ]),
    );
  });

  it("is added in the console, last in the order, and audited; a name held already is refused", async () => {
    const added = await send("POST", "/api/cities", PUNE);
    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({ city: expect.objectContaining({ name: "Pune", state: "Maharashtra" }) });
    expect((await auditFor("city.add")).results).toEqual([expect.objectContaining({ subject_id: "Pune" })]);

    expect((await send("POST", "/api/cities", PUNE)).status).toBe(409);
    expect((await send("POST", "/api/cities", { ...PUNE, name: "Nashik", zone: "Deccan" })).status).toBe(400);
  });

  it("is renamed with every row that names it, and a grant of staff access over it", async () => {
    await aTechnician({ id: "t-g", city: "Gurgaon" });
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1)",
      ),
      env.DB.prepare(
        `INSERT INTO staff_grants (email, department, level, geography, place, granted_by, granted_at)
         SELECT 'ops@localhost', 'operations', 'act', 'city', 'Gurgaon', 'ops@localhost', ?1
         WHERE EXISTS (SELECT 1 FROM staff WHERE email = 'ops@localhost')`,
      ).bind(NOW.toISOString()),
    ]);
    const renamed = await send("PATCH", "/api/cities/Gurgaon", {
      name: "Gurugram",
      state_code: "HR",
      state: "Haryana",
      zone: "NCR",
      served: true,
      active: true,
    });
    expect(renamed.status).toBe(200);
    const named = async (sql: string) => (await env.DB.prepare(sql).first<{ city: string }>())?.city;
    expect(await named("SELECT city FROM technicians WHERE id = 't-g'")).toBe("Gurugram");
    expect(await named("SELECT city FROM serviceable_pincodes WHERE pincode = '122018'")).toBe("Gurugram");
    expect(await env.DB.prepare("SELECT 1 FROM cities WHERE name = 'Gurgaon'").first()).toBeNull();
    expect((await auditFor("city.rename")).results).toEqual([expect.objectContaining({ subject_id: "Gurugram" })]);
  });

  it("is the only city a served pincode may name", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('411001', 'Camp', 'Pune', 0)",
      ).run(),
    ).rejects.toThrow(/not one of our cities/);
  });
});

describe("a city's own rules", () => {
  it("are set within the national rule's bounds, read in the city's inputs, and given back to the national rule", async () => {
    const set = await send("PATCH", "/api/cities/Mumbai/rules/checkin_radius_m", { value: 400 });
    expect(set.status).toBe(200);
    expect((await send("PATCH", "/api/cities/Mumbai/rules/checkin_radius_m", { value: 5 })).status).toBe(400);
    expect((await send("PATCH", "/api/cities/Mumbai/rules/no_show_wait_min", { value: 20 })).status).toBe(400);

    const rules = await cityRules(env.DB);
    expect(inputsIn(COMMITTED, rules.get("Mumbai") ?? {}).checkinRadiusM).toBe(400);
    expect(inputsIn(COMMITTED, rules.get("Delhi") ?? {}).checkinRadiusM).toBe(COMMITTED.checkinRadiusM);

    expect((await send("DELETE", "/api/cities/Mumbai/rules/checkin_radius_m")).status).toBe(204);
    expect((await cityRules(env.DB)).get("Mumbai")).toBeUndefined();
  });

  it("come with a job in the city, read in the same look as the job", async () => {
    await send("PATCH", "/api/cities/Mumbai/rules/checkin_radius_m", { value: 400 });
    await aTechnician({ id: "t-m", city: "Mumbai" });
    await aVisit({ id: "v-m", technician_id: "t-m", service_city: "Mumbai" });
    await aVisit({ id: "v-d", technician_id: "t-m", service_city: "Delhi" });
    expect((await workableJob(env.DB, "v-m"))?.cityRules).toEqual({ checkin_radius_m: 400 });
    expect((await workableJob(env.DB, "v-d"))?.cityRules).toEqual({});
  });

  it("hold a city's reminders until its own hour, and the others until the national one", () => {
    const tenAm = new Date("2026-09-21T04:30:00.000Z");
    const hours = { national: 9, cities: new Map([["Mumbai", 11]]) };
    expect(reminderHourCame("a.service_city", 1, hours, tenAm)?.values).toEqual(["[]", 1, '["Mumbai"]']);
    expect(reminderHourCame("a.service_city", 1, { national: 11, cities: new Map() }, tenAm)).toBeNull();
  });
});

describe("a city's own prices", () => {
  it("come before the book's there from their day, and a price still to come is taken back", async () => {
    const book = await priceOf(env.DB, "service", { on: "2026-09-30", tier: "standard" });
    expect(book).not.toBeNull();
    const set = await send("POST", "/api/cities/Mumbai/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 400_000,
      gst_percent: 18,
      valid_from: "2026-09-25",
    });
    expect(set.status).toBe(201);

    expect(await priceOf(env.DB, "service", { on: "2026-09-30", tier: "standard", city: "Mumbai" })).toEqual({
      amount_ex_gst: 400_000,
      amount: 472_000,
      gst_percent: 18,
    });
    expect(await priceOf(env.DB, "service", { on: "2026-09-24", tier: "standard", city: "Mumbai" })).toEqual(book);
    expect(await priceOf(env.DB, "service", { on: "2026-09-30", tier: "standard", city: "Delhi" })).toEqual(book);

    expect((await send("DELETE", "/api/cities/Mumbai/prices/service/standard/2026-09-25")).status).toBe(204);
    expect(await priceOf(env.DB, "service", { on: "2026-09-30", tier: "standard", city: "Mumbai" })).toEqual(book);
  });

  it("are refused before tomorrow, as the book's are", async () => {
    const today = await send("POST", "/api/cities/Mumbai/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 400_000,
      gst_percent: 18,
      valid_from: "2026-09-21",
    });
    expect(today.status).toBe(400);
  });

  it("price a visit in the city where it is", async () => {
    await send("POST", "/api/cities/Mumbai/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 400_000,
      gst_percent: 18,
      valid_from: "2026-09-22",
    });
    await aVisit({ id: "v-mumbai", service_city: "Mumbai" });
    const price = await priceOf(env.DB, "service", { on: "2026-09-22", tier: "standard", city: "Mumbai" });
    expect(price?.amount_ex_gst).toBe(400_000);
  });
});

describe("a state's GST registration", () => {
  const HEAD = { gstin: "06AAACM1234A1Z5", stateCode: "HR", sac: "999721" };

  it("supplies the visits in its state from its Books branch; any other state's from the registration in force", async () => {
    const set = await send("POST", "/api/gst-registrations", {
      state_code: "MH",
      gstin: "27AAACM1234A1Z1",
      books_branch_id: "branch-mh",
    });
    expect(set.status).toBe(201);
    const supply = await supplyFor(env.DB, HEAD);
    expect(supply("Mumbai")).toEqual({ placeOfSupply: "MH", branchId: "branch-mh" });
    expect(supply("Delhi")).toEqual({ placeOfSupply: "DL", branchId: null });
    expect(supply(null)).toEqual({ placeOfSupply: "HR", branchId: null });
    expect((await supplyFor(env.DB, NO_GST))("Mumbai")).toEqual({ placeOfSupply: null, branchId: null });

    expect(
      (
        await send("POST", "/api/gst-registrations", {
          state_code: "KA",
          gstin: "27AAACM1234A1Z1",
          books_branch_id: null,
        })
      ).status,
    ).toBe(409);
    expect((await send("DELETE", "/api/gst-registrations/MH")).status).toBe(204);
    expect((await send("DELETE", "/api/gst-registrations/MH")).status).toBe(404);
  });
});
