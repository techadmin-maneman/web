// A city's reach under Areas, and a technician's own (src/routes/ops/pincode-reach.ts,
// src/routes/ops/technician-days.ts; ADR 0223). NOW is Monday 21 September 2026, 12 noon in India. Every name and
// number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aTechnician } from "../fixtures/index.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";

const NEAR = "33333333-3333-4333-8333-333333333331";
const FAR = "33333333-3333-4333-8333-333333333332";

let ops: App;

async function pincode(pin: string, served: number, lat: number) {
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, centre_lat, centre_lng)
     VALUES (?1, 'Area ' || ?1, 'Gurgaon', ?2, ?3, 77.0266)`,
  )
    .bind(pin, served, lat)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await aTechnician({
    id: NEAR,
    name: "Imran Qureshi",
    initials: "IQ",
    city: "Gurgaon",
    home_lat: 28.4595,
    home_lng: 77.0266,
  });
  await aTechnician({
    id: FAR,
    name: "Sandeep Rawat",
    initials: "SR",
    city: "Gurgaon",
    home_lat: null,
    home_lng: null,
  });
  await pincode("122018", 1, 28.4955);
  await pincode("122099", 1, 28.7295);
  await pincode("122050", 0, 28.4655);
});

describe("a city's reach", () => {
  it("names who reaches each pincode, the nearest, and the served ones out of every reach", async () => {
    const reach = await (
      await request(ops, "/api/service-area/reach?city=Gurgaon")
    ).json<{
      technicians: { id: string; reach_min: number; home: unknown }[];
      pincodes: { pincode: string; reached: boolean | null; reached_by: string[]; nearest: unknown }[];
    }>();
    expect(reach.technicians.map(({ id, reach_min }) => ({ id, reach_min }))).toEqual([
      { id: NEAR, reach_min: 45 },
      { id: FAR, reach_min: 45 },
    ]);
    const byPin = Object.fromEntries(reach.pincodes.map((each) => [each.pincode, each]));
    expect(byPin["122018"]).toMatchObject({ reached: true, reached_by: [NEAR] });
    expect(byPin["122099"]).toMatchObject({ reached: false, reached_by: [] });
    expect(byPin["122050"]).toMatchObject({ reached: true });
  });

  it("draws the city's map", async () => {
    const map = await request(ops, "/api/service-area/map?city=Gurgaon");
    expect(map.status).toBe(200);
    expect(map.headers.get("Content-Type")).toContain("image/");
  });
});

describe("a technician's own reach", () => {
  it("is set, audited, and given back to the business's with null", async () => {
    const set = await request(ops, `/api/technicians/${NEAR}/reach`, {
      method: "POST",
      headers: POST,
      body: JSON.stringify({ reach_min: 90 }),
    });
    expect(await set.json()).toEqual({ reach_min: 90 });
    const roster = await (
      await request(ops, "/api/technicians")
    ).json<{ technicians: { id: string; reach_min: number | null }[] }>();
    expect(roster.technicians.find((each) => each.id === NEAR)?.reach_min).toBe(90);
    expect((await auditFor("technician.reach")).results).toHaveLength(1);

    const back = await request(ops, `/api/technicians/${NEAR}/reach`, {
      method: "POST",
      headers: POST,
      body: JSON.stringify({ reach_min: null }),
    });
    expect(await back.json()).toEqual({ reach_min: null });
    const outside = await request(ops, `/api/technicians/${NEAR}/reach`, {
      method: "POST",
      headers: POST,
      body: JSON.stringify({ reach_min: 5 }),
    });
    expect(outside.status).toBe(400);
  });
});
