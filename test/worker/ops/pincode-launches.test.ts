// Launches scheduled for a later day, served by the cron on the day; a city's readiness; a pause; and what stopping
// leaves behind (src/routes/ops/pincode-launches.ts, ADR 0221). NOW is Monday 21 September 2026, 12 noon in India.
// The pincodes are real only as numbers; every person is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { runDueLaunches } from "../../../src/domain/clients/launch-runs.ts";
import { takesNewClients } from "../../../src/domain/clients/service-area.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { aTechnicianInEveryCity } from "../clients.ts";
import { aConsent, aPerson } from "../fixtures/index.ts";
import { POST, auditFor } from "./ops-settings-fixtures.ts";

let ops: App;

const get = (path: string) => request(ops, path);
const post = (path: string, body: unknown) =>
  request(ops, path, { method: "POST", headers: POST, body: JSON.stringify(body) });

async function pincode(pin: string, city: string, area: string, served: number) {
  await env.DB.prepare("INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES (?1, ?2, ?3, ?4)")
    .bind(pin, area, city, served)
    .run();
}

/** Someone waiting at a pincode who asked to be told. */
async function waiting(pin: string) {
  const id = crypto.randomUUID();
  await aPerson({ id, name: "Neil Kapoor", contactable: 1 });
  await env.DB.prepare(
    `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?4)`,
  )
    .bind(crypto.randomUUID(), pin, id, NOW.toISOString())
    .run();
  await aConsent(id, { purpose: "whatsapp_launches", notice_version: "waitlist-v1", source: null });
}

const LATER = "2026-09-25";

beforeEach(async () => {
  await markDatabase();
  await aTechnicianInEveryCity();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await pincode("110001", "Delhi", "Connaught Place", 1);
  await pincode("400050", "Mumbai", "Bandra West", 0);
  await pincode("400051", "Mumbai", "Bandra East", 0);
  await pincode("122018", "Gurgaon", "Sector 65", 0);
});

describe("a launch scheduled", () => {
  it("holds a city's unserved pincodes for a later day, and lists it, audited", async () => {
    const answer = await post("/api/pincode-launches", {
      city: "Mumbai",
      pincodes: ["400050", "400051"],
      go_live_on: LATER,
    });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({
      city: "Mumbai",
      go_live_on: LATER,
      state: "scheduled",
      pincodes: [
        { pincode: "400050", area: "Bandra West" },
        { pincode: "400051", area: "Bandra East" },
      ],
      held_because: null,
    });
    const listed = await (await get("/api/pincode-launches")).json<{ launches: { state: string }[] }>();
    expect(listed.launches.map((each) => each.state)).toEqual(["scheduled"]);
    expect((await auditFor("launch.schedule")).results).toHaveLength(1);
  });

  it("refuses today, a pincode served, one in another launch, and one in another city", async () => {
    const today = await post("/api/pincode-launches", {
      city: "Mumbai",
      pincodes: ["400050"],
      go_live_on: "2026-09-21",
    });
    expect(await today.json()).toMatchObject({ error: { code: "invalid_request", fields: ["go_live_on"] } });

    const served = await post("/api/pincode-launches", { city: "Delhi", pincodes: ["110001"], go_live_on: LATER });
    expect(served.status).toBe(409);
    expect(await served.json()).toMatchObject({ error: { code: "already_served", fields: ["110001"] } });

    expect(
      (await post("/api/pincode-launches", { city: "Mumbai", pincodes: ["400050"], go_live_on: LATER })).status,
    ).toBe(201);
    const twice = await post("/api/pincode-launches", {
      city: "Mumbai",
      pincodes: ["400050"],
      go_live_on: "2026-09-30",
    });
    expect(await twice.json()).toMatchObject({ error: { code: "already_scheduled", fields: ["400050"] } });

    const elsewhere = await post("/api/pincode-launches", { city: "Mumbai", pincodes: ["122018"], go_live_on: LATER });
    expect(await elsewhere.json()).toMatchObject({ error: { code: "invalid_request", fields: ["122018"] } });
  });

  it("is cancelled once, its pincodes left unserved", async () => {
    const { id } = await (
      await post("/api/pincode-launches", { city: "Mumbai", pincodes: ["400050"], go_live_on: LATER })
    ).json<{ id: string }>();
    const cancelled = await post(`/api/pincode-launches/${id}/cancel`, {});
    expect(await cancelled.json()).toMatchObject({ state: "cancelled" });
    expect((await post(`/api/pincode-launches/${id}/cancel`, {})).status).toBe(404);
    const row = await env.DB.prepare("SELECT served FROM serviceable_pincodes WHERE pincode = '400050'").first();
    expect(row).toEqual({ served: 0 });
  });
});

describe("the cron on the day", () => {
  it("serves a launch due, tells those waiting, and marks it live; one not yet due waits", async () => {
    await waiting("400050");
    await post("/api/pincode-launches", { city: "Mumbai", pincodes: ["400050"], go_live_on: LATER });
    await post("/api/pincode-launches", { city: "Mumbai", pincodes: ["400051"], go_live_on: "2026-10-01" });

    const before = await runDueLaunches(env.DB, NOW);
    expect(before.alerts).toHaveLength(0);

    const onTheDay = new Date("2026-09-25T04:30:00.000Z");
    const run = await runDueLaunches(env.DB, onTheDay);
    expect(run.alerts).toHaveLength(1);
    expect(run.held).toEqual([]);
    const served = await env.DB.prepare(
      "SELECT pincode, served FROM serviceable_pincodes WHERE city = 'Mumbai' ORDER BY pincode",
    ).all();
    expect(served.results).toEqual([
      { pincode: "400050", served: 1 },
      { pincode: "400051", served: 0 },
    ]);
    const launches = await (
      await get("/api/pincode-launches")
    ).json<{ launches: { state: string; alerted: number | null }[] }>();
    expect(launches.launches.map(({ state, alerted }) => ({ state, alerted }))).toEqual([
      { state: "scheduled", alerted: null },
      { state: "live", alerted: 1 },
    ]);
    // Run again, it serves nothing twice.
    expect((await runDueLaunches(env.DB, onTheDay)).alerts).toHaveLength(0);
  });

  it("holds a launch in a city with no active technician, saying why", async () => {
    await post("/api/pincode-launches", { city: "Mumbai", pincodes: ["400050"], go_live_on: LATER });
    await env.DB.prepare("UPDATE technicians SET active = 0 WHERE city = 'Mumbai'").run();
    const run = await runDueLaunches(env.DB, new Date("2026-09-25T04:30:00.000Z"));
    expect(run.held).toHaveLength(1);
    expect(run.held[0]).toMatchObject({ state: "scheduled", held_because: "no_technician: 400050" });
  });
});

describe("a city's readiness", () => {
  it("counts what the city has, and what it lacks", async () => {
    const answer = await get("/api/pincode-launches/readiness?city=Mumbai&pincode=400050");
    const { checks } = await answer.json<{ checks: { check: string; ready: boolean }[] }>();
    expect(Object.fromEntries(checks.map(({ check, ready }) => [check, ready]))).toMatchObject({
      technicians: true,
      stockroom: false,
      centres: false,
    });
  });
});

describe("a pause", () => {
  it("takes no new client till the day, and refuses a pincode we do not serve", async () => {
    const paused = await post("/api/service-area/pause", { pincodes: ["110001"], until: LATER });
    expect(await paused.json()).toEqual({ changed: 1 });
    expect(await takesNewClients(env.DB, "110001", NOW)).toBe(false);
    expect(await takesNewClients(env.DB, "110001", new Date("2026-09-25T04:30:00.000Z"))).toBe(true);
    const site = await (
      await request(appFor("local", fakeDependencies(), {}, "public"), "/api/pincodes/110001")
    ).json();
    expect(site).toMatchObject({ served: false });
    expect((await auditFor("pincode.pause")).results).toHaveLength(1);

    const resumed = await post("/api/service-area/pause", { pincodes: ["110001"], until: null });
    expect(await resumed.json()).toEqual({ changed: 1 });
    expect(await takesNewClients(env.DB, "110001", NOW)).toBe(true);

    const unserved = await post("/api/service-area/pause", { pincodes: ["400050"], until: LATER });
    expect(await unserved.json()).toMatchObject({ error: { code: "invalid_request", fields: ["400050"] } });
  });
});

describe("stopping", () => {
  it("counts the visits booked ahead, and their clients", async () => {
    const answer = await get("/api/service-area/stop-impact?pincode=110001&pincode=400050");
    expect(await answer.json()).toEqual({ visits: 0, clients: 0 });
  });
});
