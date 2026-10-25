// Demand for pincodes we do not serve, the next to open, the last thirty days' launches, and served
// pincodes out of every reach (src/domain/clients/pincode-demand.ts, ADR 0224). NOW is Monday 21 September
// 2026, 12 noon in India. The pincodes are real only as numbers; every person is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { tellOfUnreachedPincodes } from "../../../src/domain/clients/pincode-reach.ts";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { aPerson, aTechnician, aVisit } from "../fixtures/index.ts";

let ops: App;
let site: App;

async function pincode(pin: string, city: string, served: number, centre: number | null = null) {
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at, centre_lat, centre_lng)
     VALUES (?1, 'Area ' || ?1, ?2, ?3, ?4, ?5, CASE WHEN ?5 IS NULL THEN NULL ELSE 77.0266 END)`,
  )
    .bind(pin, city, served, served === 1 ? "2026-09-10T18:30:00.000Z" : null, centre)
    .run();
}

async function waiting(pin: string) {
  const id = crypto.randomUUID();
  await aPerson({ id, name: "Neil Kapoor" });
  await env.DB.prepare(
    `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?4)`,
  )
    .bind(crypto.randomUUID(), pin, id, NOW.toISOString())
    .run();
}

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  site = appFor("local", fakeDependencies(), {}, "public");
});

describe("demand", () => {
  it("counts a lookup of a pincode we do not serve, a day at a time, and none of one we do", async () => {
    await pincode("110001", "Delhi", 1);
    for (const pin of ["400050", "400050", "110001"]) await request(site, `/api/pincodes/${pin}`);
    const { results } = await env.DB.prepare("SELECT pincode, day, checks FROM pincode_demand").all();
    expect(results).toEqual([{ pincode: "400050", day: "2026-09-21", checks: 2 }]);
  });

  it("ranks the next to open by those waiting, then those who looked, leaving out what we serve", async () => {
    await pincode("110001", "Delhi", 1);
    await pincode("122099", "Gurgaon", 0);
    await waiting("122099");
    await waiting("110001");
    for (let look = 0; look < 3; look += 1) await request(site, "/api/pincodes/400050");
    const next = await (
      await request(ops, "/api/pincode-demand/next")
    ).json<{ pincodes: { pincode: string; waiting: number; looked: number; city: string | null }[] }>();
    expect(
      next.pincodes.map(({ pincode, waiting: count, looked, city }) => ({ pincode, count, looked, city })),
    ).toEqual([
      { pincode: "122099", count: 1, looked: 0, city: "Gurgaon" },
      { pincode: "400050", count: 0, looked: 3, city: null },
    ]);
  });
});

describe("the last thirty days", () => {
  it("lists each pincode launched in them, with who was told and what has been booked there since", async () => {
    await pincode("122018", "Gurgaon", 1);
    await aVisit({ type: "consultation", service_pincode: "122018", synced_at: "2026-09-15T05:00:00.000Z" });
    const recent = await (
      await request(ops, "/api/pincode-launches/recent")
    ).json<{ launches: { pincode: string; launched_on: string; told: number; booked: number }[] }>();
    expect(recent.launches).toEqual([
      expect.objectContaining({ pincode: "122018", launched_on: "2026-09-11", told: 0, booked: 1 }),
    ]);
  });
});

describe("served pincodes out of every reach", () => {
  it("raise one alert a city, which closes itself once each is reached", async () => {
    await aTechnician({ city: "Gurgaon", home_lat: 28.4595, home_lng: 77.0266 });
    await pincode("122099", "Gurgaon", 1, 28.7295);
    const alerts: string[] = [];
    const resolved: string[] = [];
    const deps = {
      alertOnce: (alert: { key: string }) => {
        alerts.push(alert.key);
        return Promise.resolve();
      },
      resolveAlert: (key: string) => {
        resolved.push(key);
        return Promise.resolve();
      },
    };
    const inputs = { technicianReachMin: 45, driveEstimate: DRIVE_ESTIMATE };
    await tellOfUnreachedPincodes(env.DB, deps, inputs);
    expect(alerts).toEqual(["pincodes_unreached:Gurgaon"]);
    await env.DB.prepare("UPDATE serviceable_pincodes SET served = 0 WHERE pincode = '122099'").run();
    await tellOfUnreachedPincodes(env.DB, deps, inputs);
    expect(alerts).toHaveLength(1);
  });
});
