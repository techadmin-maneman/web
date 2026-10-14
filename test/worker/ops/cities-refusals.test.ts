// What Admin › Cities refuses, and what a city's rules and supply come to at their edges (src/routes/ops/cities.ts,
// docs/decisions/0198-cities-as-data.md). NOW is Monday 21 September 2026, 12 noon in India. Every name is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { cityOfPerson, cityOfPincode, cityOfVisit } from "../../../src/domain/cities/cities.ts";
import { cityRules, rulesFrom, setCityRule } from "../../../src/domain/cities/city-rules.ts";
import { supplyFor } from "../../../src/domain/cities/gst-registrations.ts";
import { priceFrom } from "../../../src/domain/money/price-lookup.ts";
import type { App } from "../../../src/http/context.ts";
import { anAddress, aPerson, aVisit } from "../fixtures/index.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";

let ops: App;

const send = (method: string, path: string, body?: unknown) =>
  request(ops, path, { method, headers: POST, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const MUMBAI = { name: "Mumbai", state_code: "MH", state: "Maharashtra", zone: null, served: false, active: true };

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("a change to a city", () => {
  it("keeps its name and changes the rest, audited as a change", async () => {
    const changed = await send("PATCH", "/api/cities/Mumbai", { ...MUMBAI, served: true });
    expect(changed.status).toBe(200);
    expect(await changed.json<unknown>()).toMatchObject({ city: { name: "Mumbai", served: true } });
    expect((await auditFor("city.change")).results).toEqual([expect.objectContaining({ subject_id: "Mumbai" })]);
  });

  it("refuses a city we do not hold, a zone that is none of ours, and a name another city has", async () => {
    expect((await send("PATCH", "/api/cities/Atlantis", MUMBAI)).status).toBe(404);
    const zone = await send("PATCH", "/api/cities/Mumbai", { ...MUMBAI, zone: "Deccan" });
    expect(zone.status).toBe(400);
    expect(await zone.json<unknown>()).toMatchObject({ error: { code: "invalid_request", fields: ["zone"] } });
    expect((await send("PATCH", "/api/cities/Mumbai", { ...MUMBAI, name: "Delhi" })).status).toBe(409);
  });

  it("refuses a rule or a price for a city we do not hold, and a price still to come that is not there", async () => {
    expect((await send("PATCH", "/api/cities/Atlantis/rules/reminder_hour", { value: 10 })).status).toBe(404);
    expect((await send("DELETE", "/api/cities/Atlantis/rules/reminder_hour")).status).toBe(404);
    const price = { item: "service", tier: "standard", amount_ex_gst: 1, gst_percent: 18, valid_from: "2026-10-01" };
    expect((await send("POST", "/api/cities/Atlantis/prices", price)).status).toBe(404);
    expect((await send("DELETE", "/api/cities/Mumbai/prices/service/standard/2026-10-01")).status).toBe(404);
  });
});

describe("a city's own rule or price, refused", () => {
  it("names the figure outside the national rule's bounds, and refuses a rule a city cannot set", async () => {
    const low = await send("PATCH", "/api/cities/Mumbai/rules/reminder_hour", { value: 3 });
    expect(low.status).toBe(400);
    expect(await low.json<unknown>()).toMatchObject({ error: { code: "invalid_request", fields: ["reminder_hour"] } });
    const audit = { surface: "ops", actor: { kind: "staff", id: "ops@localhost" }, requestId: null } as const;
    const national = await setCityRule(env.DB, { city: "Mumbai", name: "no_show_wait_min", value: 20 }, audit, NOW);
    expect(national).toEqual({ kind: "national_only" });
  });

  it("refuses a city's price for a service retired by its day", async () => {
    await env.DB.prepare(
      "UPDATE services SET retired_date = '2026-09-25' WHERE kind = 'service' AND tier = 'standard'",
    ).run();
    const retired = await send("POST", "/api/cities/Mumbai/prices", {
      item: "service",
      tier: "standard",
      amount_ex_gst: 400_000,
      gst_percent: 18,
      valid_from: "2026-09-30",
    });
    expect(retired.status).toBe(400);
    expect(await retired.json<unknown>()).toMatchObject({ error: { code: "service_retired" } });
  });
});

describe("a city's own rules, as stored", () => {
  it("are read only where the register still takes them", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO city_settings (city, key, value, updated_by, updated_at) VALUES ('Mumbai', 'reminder_hour', '3', 'ops', ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO city_settings (city, key, value, updated_by, updated_at) VALUES ('Mumbai', 'checkin_radius_m', 'x', 'ops', ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        "INSERT INTO city_settings (city, key, value, updated_by, updated_at) VALUES ('Delhi', 'care_hours', '{}', 'ops', ?1)",
      ).bind(NOW.toISOString()),
    ]);
    expect((await cityRules(env.DB)).size).toBe(0);
  });

  it("read as JSON keep what the register takes, and nothing of what is not JSON", () => {
    expect(rulesFrom('{"checkin_radius_m": 300, "reminder_hour": 99}')).toEqual({ checkin_radius_m: 300 });
    expect(rulesFrom("not json")).toEqual({});
    expect(rulesFrom("[1]")).toEqual({});
    expect(rulesFrom(null)).toEqual({});
  });
});

describe("where a visit, a pincode and a client are", () => {
  it("is their city, or none where nothing names one", async () => {
    const person = await aPerson();
    await anAddress(person.id ?? "", { pincode: "400050" });
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('400050', 'Bandra', 'Mumbai', 1)",
    ).run();
    await aVisit({ id: "v-1", person_id: person.id ?? "", service_city: "Mumbai" });
    expect(await cityOfPerson(env.DB, person.id ?? "")).toBe("Mumbai");
    expect(await cityOfPerson(env.DB, "nobody")).toBeNull();
    expect(await cityOfPincode(env.DB, "400050")).toBe("Mumbai");
    expect(await cityOfPincode(env.DB, null)).toBeNull();
    expect(await cityOfPincode(env.DB, "999999")).toBeNull();
    expect(await cityOfVisit(env.DB, "v-1")).toBe("Mumbai");
    expect(await cityOfVisit(env.DB, "v-none")).toBeNull();
  });

  it("supplies a city whose state is not set from the registration in force", async () => {
    await env.DB.prepare("INSERT INTO cities (name, served, active, sort) VALUES ('Atlantis', 0, 1, 99)").run();
    const supply = await supplyFor(env.DB, { gstin: "06AAACM1234A1Z5", stateCode: "HR", sac: "999721" });
    expect(supply("Atlantis")).toEqual({ placeOfSupply: "HR", branchId: null });
  });

  it("prices nothing a lookup found none for", () => {
    expect(priceFrom(null)).toBeNull();
  });
});
