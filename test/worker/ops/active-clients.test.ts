// Settings' counts of active clients (src/domain/clients/active-clients.ts): a city's (by its pincodes), a package's
// and a pincode's, each counting only clients whose stage is active, a package's within its reader's reach. NOW is Monday 21 September 2026, noon in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person as staff } from "./staff-fixtures.ts";
import { person } from "./ops-clients-fixtures.ts";
import { aPackage, aVisit } from "../fixtures/index.ts";

const ROHIT = "11111111-1111-4111-8111-111111111111";
const ARJUN = "11111111-1111-4111-8111-111111111115";

let ops: App;

const fitted = (personId: string, start: string) =>
  aVisit({ person_id: personId, type: "first_fit", status: "completed", window_start: start });

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  // Rohit, fitted on 20 August on a 30-day package, is active; Arjun, fitted in March, is long past it.
  await person(ROHIT, "Rohit Malhotra", "+919810000001");
  await person(ARJUN, "Arjun Shah", "+919810000005");
  await aPackage({ code: "natural", name: "Natural hair system", firstFit: 3_000_000, everyDays: 30 });
  await env.DB.prepare("INSERT OR IGNORE INTO cities (name, served, active, sort) VALUES ('Gurgaon', 1, 1, 1)").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1)",
  ).run();
  await env.DB.prepare("UPDATE people SET package = 'natural', pincode = '122018' WHERE id IN (?1, ?2)")
    .bind(ROHIT, ARJUN)
    .run();
  await fitted(ROHIT, "2026-08-20T04:30:00.000Z");
  await fitted(ARJUN, "2026-03-02T04:30:00.000Z");
});

describe("the active clients Settings counts", () => {
  it("counts a city's, a package's and a pincode's active clients alone", async () => {
    const cities = await (
      await request(ops, "/api/cities")
    ).json<{
      cities: { name: string; active_clients: number }[];
    }>();
    expect(cities.cities.find((city) => city.name === "Gurgaon")?.active_clients).toBe(1);

    const packages = await (
      await request(ops, "/api/packages")
    ).json<{
      packages: { code: string; active_clients: number }[];
    }>();
    expect(packages.packages.find((each) => each.code === "natural")?.active_clients).toBe(1);

    const area = await (await request(ops, "/api/service-area")).json<{ active_clients: Record<string, number> }>();
    expect(area.active_clients).toEqual({ "122018": 1 });
  });

  it("counts no client kept for testing", async () => {
    await env.DB.prepare("UPDATE people SET test_record = 1 WHERE id = ?1").bind(ROHIT).run();
    const area = await (await request(ops, "/api/service-area")).json<{ active_clients: Record<string, number> }>();
    expect(area.active_clients).toEqual({});
  });

  it("counts no client erased", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(ROHIT, NOW.toISOString()).run();
    const area = await (await request(ops, "/api/service-area")).json<{ active_clients: Record<string, number> }>();
    expect(area.active_clients).toEqual({});
  });

  it("counts a package's clients in the cities its reader's work reaches", async () => {
    await listStaff("delhi.finance@maneman.test", ["finance:view:city:Delhi"]);
    await listStaff("gurgaon.finance@maneman.test", ["finance:view:city:Gurgaon"]);
    await enforce();
    const countFor = async (email: string) => {
      const read = await (
        await request(opsAs(staff(email)), "/api/packages")
      ).json<{
        packages: { code: string; active_clients: number }[];
      }>();
      return read.packages.find((each) => each.code === "natural")?.active_clients;
    };
    expect(await countFor("delhi.finance@maneman.test")).toBe(0);
    expect(await countFor("gurgaon.finance@maneman.test")).toBe(1);
  });
});
