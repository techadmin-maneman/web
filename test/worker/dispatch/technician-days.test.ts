// What booking by start time reads of a technician's days, as ops set them in the console: their own week of hours,
// where their day starts, and leave over part of one day. And each pincode's centre, placed hourly. NOW is Monday 21
// September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { placePincodeCentres, pincodeCentre } from "../../../src/domain/cities/pincode-centres.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import type { App } from "../../../src/http/context.ts";
import { createLogger } from "../../../src/log.ts";
import { appFor, captureLogs, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, request } from "../helpers.ts";
import { aTechnician, aVisit } from "../fixtures/index.ts";

const IMRAN = "33333333-3333-4333-8333-333333333331";

interface Roster {
  readonly technicians: {
    id: string;
    hours: { weekday: number; starts: string; ends: string }[];
    home: { label: string } | null;
    leave: { from: string; from_time: string | null; to_time: string | null }[];
  }[];
}

let ops: App;
const deps = fakeDependencies();

const send = (method: string, path: string, body?: unknown) =>
  request(ops, path, {
    method,
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const imran = async () => {
  const roster = await (await send("GET", "/api/technicians")).json<Roster>();
  const found = roster.technicians.find((technician) => technician.id === IMRAN);
  if (found === undefined) throw new Error("Imran is not on the roster");
  return found;
};

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", deps, {}, "ops");
  await aTechnician({ id: IMRAN, mobile_e164: "+919810000009" });
});

describe("a technician's own week", () => {
  it("is set day by day, read back in weekday order, and returned to the city's hours when emptied", async () => {
    const week = [
      { weekday: 3, starts: "10:00", ends: "19:00" },
      { weekday: 1, starts: "09:00", ends: "18:30" },
    ];
    const set = await send("POST", `/api/technicians/${IMRAN}/hours`, { days: week });
    expect(set.status).toBe(200);
    expect((await imran()).hours).toEqual([
      { weekday: 1, starts: "09:00", ends: "18:30" },
      { weekday: 3, starts: "10:00", ends: "19:00" },
    ]);

    await send("POST", `/api/technicians/${IMRAN}/hours`, { days: [] });
    expect((await imran()).hours).toEqual([]);
  });

  it("refuses a day twice, a time off the quarter hour, and a day that ends before it starts", async () => {
    const refused = await Promise.all(
      [
        [
          { weekday: 1, starts: "09:00", ends: "18:00" },
          { weekday: 1, starts: "10:00", ends: "19:00" },
        ],
        [{ weekday: 2, starts: "09:10", ends: "18:00" }],
        [{ weekday: 2, starts: "18:00", ends: "09:00" }],
      ].map((days) => send("POST", `/api/technicians/${IMRAN}/hours`, { days })),
    );
    expect(refused.map((answer) => answer.status)).toEqual([400, 400, 400]);
    expect((await imran()).hours).toEqual([]);
  });

  it("answers not found for a technician nobody has added", async () => {
    const answer = await send("POST", "/api/technicians/33333333-3333-4333-8333-333333333339/hours", { days: [] });
    expect(answer.status).toBe(404);
  });
});

describe("where a technician's day starts", () => {
  it("is found with the building search and kept with its coordinate", async () => {
    const search = await send("POST", `/api/technicians/${IMRAN}/home/suggestions`, { q: "Sunrise", session: "s1" });
    const { suggestions } = await search.json<{ suggestions: { place_id: string }[] }>();
    expect(suggestions[0]?.place_id).toBe("stub-place-sunrise");

    const chosen = await send("POST", `/api/technicians/${IMRAN}/home`, {
      place_id: "stub-place-sunrise",
      session_token: "s1",
    });
    expect(chosen.status).toBe(200);
    expect((await imran()).home).toEqual({ label: "Sunrise Greens, Sector 65, Gurugram, Haryana 122018, India" });
    const kept = await env.DB.prepare("SELECT home_lat, home_lng FROM technicians WHERE id = ?1")
      .bind(IMRAN)
      .first<{ home_lat: number; home_lng: number }>();
    expect(kept).toEqual({ home_lat: 28.3951, home_lng: 77.0619 });
  });

  it("is refused for a place Google cannot find, and the home before it stays", async () => {
    const answer = await send("POST", `/api/technicians/${IMRAN}/home`, { place_id: "nowhere", session_token: "s2" });
    expect(answer.status).toBe(503);
    expect((await imran()).home).toBeNull();
  });
});

describe("leave over part of one day", () => {
  it("names only the jobs its hours cover", async () => {
    // 10:30 to 12:00 and 3:30 to 5:00 pm in India on Tuesday 22 September.
    const morning = await aVisit({ technician_id: IMRAN, window_start: "2026-09-22T05:00:00.000Z" });
    await aVisit({ technician_id: IMRAN, window_start: "2026-09-22T10:00:00.000Z" });

    const answer = await send("POST", `/api/technicians/${IMRAN}/leave`, {
      from: "2026-09-22",
      to: "2026-09-22",
      from_time: "09:00",
      to_time: "13:00",
    });

    const { jobs } = await answer.json<{ jobs: { appointment_id: string }[] }>();
    expect(jobs.map((job) => job.appointment_id)).toEqual([morning.id]);
    expect((await imran()).leave).toEqual([
      expect.objectContaining({ from: "2026-09-22", from_time: "09:00", to_time: "13:00" }),
    ]);
  });

  it("is refused across two days, with one time alone, or the wrong way round", async () => {
    const refused = await Promise.all(
      [
        { from: "2026-09-22", to: "2026-09-23", from_time: "09:00", to_time: "13:00" },
        { from: "2026-09-22", to: "2026-09-22", from_time: "09:00" },
        { from: "2026-09-22", to: "2026-09-22", from_time: "13:00", to_time: "09:00" },
      ].map((body) => send("POST", `/api/technicians/${IMRAN}/leave`, body)),
    );
    expect(refused.map((answer) => answer.status)).toEqual([400, 400, 400]);
  });
});

describe("a pincode's centre", () => {
  const pass = () =>
    placePincodeCentres({
      db: env.DB,
      geocode: deps.geocode,
      alert: deps.alert,
      log: createLogger(),
      budget: createCallBudget(50),
      settings: LOCAL_SETTINGS,
      now: NOW,
    });

  it("is placed once, and one Google cannot place is not asked for again within the week", async () => {
    await env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1),
         ('000000', 'Nowhere', 'Gurgaon', 0)`,
    ).run();

    expect(await pass()).toBe(1);
    expect(await pincodeCentre(env.DB, "122018")).toEqual({ lat: 28.418, lng: 77.068 });
    expect(await pincodeCentre(env.DB, "000000")).toBeNull();
    expect(await pass()).toBe(0);
  });
});
