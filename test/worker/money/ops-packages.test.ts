// Packages in the console (src/routes/ops/packages.ts, docs/decisions/0211-packages.md). NOW is Monday 21 September
// 2026, 12 noon in India. Nothing here is a person.
//
// What these hold: a package is added with its first fit, service visit and replacement under its code, changed a box
// at a time with its audit entry, put in order, retired from a day and sold again, and deleted only while nothing was
// sold under it; a first fit costs its hair system and its service visit, a replacement itself and its service visit;
// and a service visit falls due no further on than clients may book.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aHairSystemOf, aPackage } from "../fixtures/index.ts";
import { NEXT_VISIT_DAYS } from "../../../src/policy/next-visit.ts";

let ops: App;

const HEADERS = { "Content-Type": "application/json", Origin: "https://maneman.test" };

const send = (method: string, path: string, body?: unknown) =>
  request(ops, path, { method, headers: HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

interface Price {
  amount_ex_gst: number;
  amount: number;
  gst_percent: number;
}

interface Package {
  code: string;
  name: string;
  description: string | null;
  sort: number;
  retired_date: string | null;
  offered: boolean;
  deletable: boolean;
  first_fit: { minutes: number; from: Price | null };
  service: { minutes: number; every_days: number; price: Price | null };
  replacement: { minutes: number; after_months: number; price: Price | null; total: Price | null };
  hair_systems: { code: string; price: Price | null; offered: boolean }[];
}

const packages = async (): Promise<Package[]> =>
  (await (await request(ops, "/api/packages")).json<{ packages: Package[] }>()).packages;

const packageCoded = async (code: string): Promise<Package> => {
  const found = (await packages()).find((each) => each.code === code);
  if (found === undefined) throw new Error(`${code} is not in the answer`);
  return found;
};

const auditFor = (action: string) =>
  env.DB.prepare("SELECT actor, subject_id, detail FROM audit_log WHERE action = ?1 ORDER BY id")
    .bind(action)
    .all<{ actor: string; subject_id: string; detail: string | null }>();

const servicesUnder = (code: string) =>
  env.DB.prepare("SELECT kind, name, minutes FROM services WHERE tier = ?1 ORDER BY kind").bind(code).all();

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("the packages, before anybody adds one", () => {
  it("are the standard one the migrations leave, with no hair system and so no first fit to sell", async () => {
    const [standard, ...others] = await packages();
    expect(others).toEqual([]);
    expect(standard).toMatchObject({
      code: "standard",
      name: "First fit",
      retired_date: "2026-10-02",
      offered: false,
      first_fit: { minutes: 180, from: null },
      service: { minutes: 90, every_days: 30, price: { amount_ex_gst: 200_000 } },
      replacement: { minutes: 135, after_months: 6, price: { amount_ex_gst: 1_500_000 } },
      hair_systems: [],
    });
    // A replacement costs itself and its service visit.
    expect(standard?.replacement.total).toMatchObject({ amount_ex_gst: 1_700_000 });
  });
});

describe("adding a package", () => {
  it("adds its three services under a code made from its name, each named from it and timed as its kind is", async () => {
    const answer = await send("POST", "/api/packages", { name: "Mane Man Active" });

    expect(answer.status).toBe(201);
    expect(await packageCoded("mane_man_active")).toMatchObject({
      name: "Mane Man Active",
      offered: false,
      deletable: true,
      first_fit: { minutes: 180, from: null },
      service: { minutes: 90, every_days: 30, price: null },
      replacement: { minutes: 135, after_months: 6, price: null },
    });
    expect((await servicesUnder("mane_man_active")).results).toEqual([
      { kind: "first_fit", name: "Mane Man Active", minutes: 180 },
      { kind: "replacement", name: "Mane Man Active replacement", minutes: 135 },
      { kind: "service", name: "Mane Man Active service visit", minutes: 90 },
    ]);
    expect((await auditFor("package.add")).results).toMatchObject([
      { actor: "ops@localhost", subject_id: "mane_man_active" },
    ]);
  });

  it("refuses a name a service has, and a code a package has, and adds nothing", async () => {
    const taken = await send("POST", "/api/packages", { name: "Consultation" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: { code: "service_exists", fields: ["name"] } });
    const code = await send("POST", "/api/packages", { name: "Another", code: "standard" });
    expect(await code.json()).toMatchObject({ error: { code: "service_exists", fields: ["code"] } });
    expect((await packages()).map((each) => each.code)).toEqual(["standard"]);
  });

  it("sells its first fit once a hair system and its service visit have prices, from the cheapest hair system", async () => {
    await aPackage({ code: "natural", name: "Mane Man Natural", firstFit: 4_500_000, serviceVisit: 220_000 });
    expect(await packageCoded("natural")).toMatchObject({
      offered: true,
      first_fit: { from: { amount_ex_gst: 4_500_000 } },
      service: { price: { amount_ex_gst: 220_000 } },
      replacement: { total: { amount_ex_gst: 1_500_000 } },
    });
    // A second hair system at a lower price is where the first fit is sold from.
    const smaller = { baseWidthIn: 7, baseLengthIn: 9, colour: "2", greyPercent: 10, densityPercent: 100 };
    await aHairSystemOf({ code: "natural", firstFit: 3_220_000, serviceVisit: 220_000, spec: smaller });
    expect((await packageCoded("natural")).first_fit.from).toMatchObject({ amount_ex_gst: 3_220_000 });
  });
});

describe("changing a package", () => {
  beforeEach(async () => {
    await aPackage({ code: "essential", name: "Mane Man Essential", firstFit: 3_200_000 });
  });

  it("renames its three services with it, and keeps its code, and so every price it has", async () => {
    const answer = await send("PATCH", "/api/packages/essential", { name: "Mane Man Classic" });

    expect(answer.status).toBe(200);
    expect((await servicesUnder("essential")).results).toEqual([
      { kind: "first_fit", name: "Mane Man Classic", minutes: 180 },
      { kind: "replacement", name: "Mane Man Classic replacement", minutes: 135 },
      { kind: "service", name: "Mane Man Classic service visit", minutes: 90 },
    ]);
    expect((await packageCoded("essential")).first_fit.from).toMatchObject({ amount_ex_gst: 3_200_000 });
    const { results } = await auditFor("package.change");
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({ renamed: true });
  });

  it("times each part, sets how often its service visit falls due and how long its hair system is worn", async () => {
    const answer = await send("PATCH", "/api/packages/essential", {
      first_fit_minutes: 210,
      service_minutes: 75,
      service_every_days: 21,
      replacement_minutes: 150,
      replace_after_months: 4,
    });

    expect(answer.status).toBe(200);
    expect(await packageCoded("essential")).toMatchObject({
      first_fit: { minutes: 210 },
      service: { minutes: 75, every_days: 21 },
      replacement: { minutes: 150, after_months: 4 },
    });
    const { results } = await auditFor("package.change");
    expect(JSON.parse(results[0]?.detail ?? "{}")).toEqual({
      first_fit_minutes: 210,
      service_minutes: 75,
      service_every_days: 21,
      replacement_minutes: 150,
      replace_after_months: 4,
    });
  });

  it.each([
    ["a length under half an hour", { service_minutes: 20 }, "service_minutes"],
    ["a service visit due past how far ahead clients may book", { service_every_days: 60 }, "service_every_days"],
    ["a hair system worn for more than three years", { replace_after_months: 40 }, "replace_after_months"],
    ["a description with a line break", { description: "One\nTwo" }, "description"],
  ])("refuses %s, naming the box, and records nothing", async (_, change, field) => {
    const answer = await send("PATCH", "/api/packages/essential", change);

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: [field] } });
    expect((await auditFor("package.change")).results).toHaveLength(0);
  });

  it("records nothing for a change that changes nothing, and answers not_found for no such package", async () => {
    expect((await send("PATCH", "/api/packages/essential", { service_every_days: 30 })).status).toBe(200);
    expect((await auditFor("package.change")).results).toHaveLength(0);
    expect((await send("PATCH", "/api/packages/lace", { service_every_days: 21 })).status).toBe(404);
  });

  it("puts the packages in the order given, every one of them once", async () => {
    expect((await send("POST", "/api/packages/order", { codes: ["essential"] })).status).toBe(400);
    const answer = await send("POST", "/api/packages/order", { codes: ["essential", "standard"] });

    expect(answer.status).toBe(200);
    expect((await packages()).map((each) => each.code)).toEqual(["essential", "standard"]);
    expect((await auditFor("package.reorder")).results).toHaveLength(1);
  });
});

describe("retiring and deleting a package", () => {
  beforeEach(async () => {
    await aPackage({ code: "essential", name: "Mane Man Essential", firstFit: 3_200_000 });
  });

  it("stops selling it from the day given and sells it again once restored, its service visit sold throughout", async () => {
    expect((await send("POST", "/api/packages/essential/retire", { from: "2026-09-21" })).status).toBe(200);
    expect(await packageCoded("essential")).toMatchObject({ retired_date: "2026-09-21", offered: false });
    const site = appFor("local", fakeDependencies());
    const sold = await (
      await request(site, "/api/published-prices")
    ).json<{ services: { type: string; tier: string }[] }>();
    expect(sold.services.filter((each) => each.tier === "essential").map((each) => each.type)).toEqual([
      "service",
      "replacement",
    ]);

    expect((await send("POST", "/api/packages/essential/restore")).status).toBe(200);
    expect(await packageCoded("essential")).toMatchObject({ retired_date: null, offered: true });
  });

  it("deletes one never sold, with its services and prices, and records it", async () => {
    await env.DB.prepare("DELETE FROM price_book WHERE item = 'hair_system'").run();
    await env.DB.prepare("DELETE FROM hair_systems WHERE product = 'essential'").run();
    const answer = await send("DELETE", "/api/packages/essential");

    expect(answer.status).toBe(204);
    expect((await packages()).map((each) => each.code)).toEqual(["standard"]);
    expect((await servicesUnder("essential")).results).toEqual([]);
    const prices = await env.DB.prepare("SELECT COUNT(*) AS n FROM price_book WHERE tier = 'essential'").first();
    expect(prices).toEqual({ n: 0 });
    expect((await auditFor("package.delete")).results).toMatchObject([{ subject_id: "essential" }]);
  });

  it("refuses to delete one a hair system is in, or a client is on, which is retired instead", async () => {
    const withHairSystem = await send("DELETE", "/api/packages/essential");
    expect(withHairSystem.status).toBe(409);
    expect(await withHairSystem.json()).toMatchObject({ error: { code: "in_use" } });
    expect((await packageCoded("essential")).deletable).toBe(false);
    expect((await auditFor("package.delete")).results).toHaveLength(0);
  });
});

describe("the booking horizon", () => {
  it("is refused short of a package's service cadence, naming both boxes", async () => {
    await aPackage({ code: "essential", name: "Mane Man Essential", firstFit: 3_200_000, everyDays: 40 });
    const answer = await send("POST", "/api/settings/booking_days", { value: { ...NEXT_VISIT_DAYS, horizon: 35 } });
    expect(answer.status).toBe(422);
    expect(await answer.json()).toMatchObject({
      error: { code: "figures_conflict", fields: ["booking_days.horizon", "packages.service_every_days"] },
    });
  });
});
