// The board's day on the road (ADR 0120): drive times between each technician's visits, whether each fits the gap, the
// day's map, and the move picker's nearest first. NOW is Monday 21 September 2026, 12 noon in India. Every name and
// address here is made up; each test that answers its own drives pins its clients afresh, since Google's answers
// are kept a day.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { kmBetween } from "../../../src/lib/geo.ts";
import type { RoutesProvider } from "../../../src/providers/routes/index.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { A, B, FIT, IMRAN, insertJob, ROHIT, SAMEER, TUESDAY, VIKRAM, WEDNESDAY } from "./dispatch-fixtures.ts";

const ARJUN = "11111111-1111-4111-8111-111111111113";
const ROHIT_HOME = { lat: 28.4595, lng: 77.0266 };
const VIKRAM_HOME = { lat: 28.4089, lng: 77.0418 };

interface DayBody {
  drive_times: string;
  technicians: {
    technician_id: string;
    colour: string;
    stops: { appointment_id: string; ends_at: string; located: boolean }[];
    legs: { from: string; to: string; minutes: number; km: number; gap_minutes: number; fits: boolean }[];
  }[];
}

const pin = (person: string, at: { lat: number; lng: number } | null) =>
  env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng)
     VALUES (?1, ?1, ?2, 'House 1', 'Sector 45', 'Gurgaon', '122003', ?3, ?4)`,
  )
    .bind(person, NOW.toISOString(), at?.lat ?? null, at?.lng ?? null)
    .run();

const opsWith = (routes: RoutesProvider | null): App => appFor("local", fakeDependencies({ routes }), {}, "ops");
const dayOf = (app: App, date = "2026-09-22") => request(app, `/api/dispatch/day?date=${date}`);

/** Every drive the same length, numbered so no other test's kept answer is read for it. */
const drivingFor = (minutes: number): RoutesProvider => ({
  route: (stops) =>
    Promise.resolve({
      ok: true,
      legs: stops.slice(1).map(() => ({ seconds: minutes * 60, meters: 12_345 })),
      polyline: null,
    }),
  map: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
  areaMap: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
});

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, updated_at, city)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', ?3, 'Gurgaon'),
            (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', ?3, 'Gurgaon')`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name)
     VALUES (?1, ?4, '+919810000001', 'Rohit Malhotra'), (?2, ?4, '+919810009902', 'Vikram Sethi'),
            (?3, ?4, '+919810009903', 'Arjun Rao')`,
  )
    .bind(ROHIT, VIKRAM, ARJUN, NOW.toISOString())
    .run();
  // Imran's Tuesday: Rohit at 9, Vikram at 12, then Arjun, whose address has no pin, at 2.
  await insertJob(A, { type: "service", start: TUESDAY["09:00"], technician: IMRAN, person: ROHIT });
  await insertJob(B, { type: "service", start: TUESDAY["12:00"], technician: IMRAN, person: VIKRAM });
  await insertJob(FIT, { type: "service", start: TUESDAY["14:00"], technician: IMRAN, person: ARJUN });
});

describe("GET /api/dispatch/day", () => {
  it("gives each technician's visits in order, and the drive between each two with a pin, against the gap", async () => {
    await pin(ROHIT, ROHIT_HOME);
    await pin(VIKRAM, VIKRAM_HOME);
    await pin(ARJUN, null);

    const res = await dayOf(opsWith(drivingFor(25)));
    expect(res.status).toBe(200);
    const body = await res.json<DayBody>();
    expect(body.drive_times).toBe("shown");
    // Only technicians with a visit that day.
    expect(body.technicians.map((each) => each.technician_id)).toEqual([IMRAN]);
    const [imran] = body.technicians;
    expect(imran?.stops.map((stop) => [stop.appointment_id, stop.located])).toEqual([
      [A, true],
      [B, true],
      [FIT, false],
    ]);
    // A service visit holds one slot, 90 minutes: Rohit's ends at 10:30, an hour and a half before Vikram's.
    expect(imran?.stops[0]?.ends_at).toBe(TUESDAY["10:30"]);
    expect(imran?.legs).toEqual([{ from: A, to: B, minutes: 25, km: 12.3, gap_minutes: 90, fits: true }]);
  });

  it("says a drive does not fit when it is longer than the gap", async () => {
    await pin(ROHIT, { lat: 28.4601, lng: 77.0301 });
    await pin(VIKRAM, { lat: 28.4102, lng: 77.0433 });

    const body = await (await dayOf(opsWith(drivingFor(100)))).json<DayBody>();
    expect(body.technicians[0]?.legs).toEqual([
      expect.objectContaining({ from: A, to: B, minutes: 100, gap_minutes: 90, fits: false }),
    ]);
  });

  it("shows the visits with no drive times where none are switched on", async () => {
    await pin(ROHIT, ROHIT_HOME);
    await pin(VIKRAM, VIKRAM_HOME);

    const body = await (await dayOf(opsWith(null))).json<DayBody>();
    expect(body.drive_times).toBe("off");
    expect(body.technicians[0]?.stops).toHaveLength(3);
    expect(body.technicians[0]?.legs).toEqual([]);
  });

  it("says the drive times are unavailable when Google fails", async () => {
    await pin(ROHIT, { lat: 28.4611, lng: 77.0311 });
    await pin(VIKRAM, { lat: 28.4111, lng: 77.0444 });
    const failing: RoutesProvider = {
      route: () => Promise.resolve({ ok: false, detail: "HTTP 500" }),
      map: () => Promise.resolve({ ok: false, detail: "HTTP 500" }),
      areaMap: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
    };

    const body = await (await dayOf(opsWith(failing))).json<DayBody>();
    expect(body.drive_times).toBe("unavailable");
    expect(body.technicians[0]?.legs).toEqual([]);
  });
});

describe("GET /api/dispatch/day/map", () => {
  const mapOf = (app: App) => request(app, "/api/dispatch/day/map?date=2026-09-22");

  it("draws the day through us, never handing the console the key", async () => {
    await pin(ROHIT, ROHIT_HOME);
    const res = await mapOf(appFor("local", fakeDependencies(), {}, "ops"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  it("has nothing to draw when no visit that day has a pin", async () => {
    expect((await mapOf(appFor("local", fakeDependencies(), {}, "ops"))).status).toBe(404);
  });

  it("is unavailable where the map is not switched on", async () => {
    await pin(ROHIT, ROHIT_HOME);
    expect((await mapOf(opsWith(null))).status).toBe(503);
  });
});

describe("GET /api/dispatch/room, nearest first", () => {
  it("gives the km from the job to the nearest of each technician's other visits that day", async () => {
    await pin(ROHIT, ROHIT_HOME);
    await pin(VIKRAM, VIKRAM_HOME);
    await insertJob("22222222-2222-4222-8222-2222222222c1", {
      type: "service",
      start: "2026-09-23T03:30:00.000Z",
      technician: SAMEER,
      person: VIKRAM,
    });

    const res = await request(
      appFor("local", fakeDependencies(), {}, "ops"),
      `/api/dispatch/room?appointment_id=${A}&from=2026-09-21`,
    );
    const { rooms } = await res.json<{ rooms: { technician_id: string; date: string; km: number | null }[] }>();
    const sameerWednesday = rooms.find((room) => room.technician_id === SAMEER && room.date === WEDNESDAY);
    expect(sameerWednesday?.km).toBe(Math.round(kmBetween(ROHIT_HOME, VIKRAM_HOME) * 10) / 10);
    // A day with none of their visits, or none pinned, is not ranked.
    const sameerThursday = rooms.find((room) => room.technician_id === SAMEER && room.date === "2026-09-24");
    expect(sameerThursday?.km).toBeNull();
  });
});
