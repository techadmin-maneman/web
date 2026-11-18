// Google's word on the drives either side of a start (src/domain/booking/drive-check.ts): a start the free estimate
// offered is held only where Google's drive from the visit before, and the time to park, still reach it. Where Google
// cannot answer, the estimate stands. Every pin here is made up.

import { beforeEach, describe, expect, it } from "vitest";
import { drivesFit, type DriveCheck, type TooTight } from "../../../src/domain/booking/drive-check.ts";
import { minuteOf, type PlanDay, type PlanRules } from "../../../src/policy/day-plan.ts";
import { DRIVE_ESTIMATE, driveMinutes } from "../../../src/policy/drive-estimate.ts";
import { BOOKING_RULES } from "../../../src/policy/start-times.ts";
import type { RoutesProvider } from "../../../src/providers/routes/index.ts";
import { env } from "cloudflare:workers";
import { LOCAL_SETTINGS, markDatabase, NOW } from "../helpers.ts";

const RULES: PlanRules = { booking: BOOKING_RULES, drive: DRIVE_ESTIMATE };

/** A day with one visit, 10 to 11:30, at a pin of its own: each test's own, so Google's kept answers never meet. */
const dayAt = (lat: number): PlanDay => ({
  opens: minuteOf("09:00"),
  closes: minuteOf("20:00"),
  home: null,
  stops: [{ start: minuteOf("10:00"), end: minuteOf("11:30"), pin: { lat, lng: 77.05 }, fit: false }],
  away: [],
});

/** Google, answering every drive in `minutes`, failing, or refusing with `refusal`; what ops were told. */
function google(
  minutes: number | null,
  refusal: string | null = null,
): { check: DriveCheck; asked: number[]; told: string[]; tight: TooTight[] } {
  const asked: number[] = [];
  const told: string[] = [];
  const tight: TooTight[] = [];
  const routes: RoutesProvider = {
    route: (stops) => {
      asked.push(stops.length);
      return Promise.resolve(
        minutes === null
          ? { ok: false, detail: refusal ?? "down" }
          : { ok: true, legs: stops.slice(1).map(() => ({ seconds: minutes * 60, meters: 1000 })), polyline: null },
      );
    },
    map: () => Promise.resolve({ ok: false, detail: "no map here" }),
    areaMap: () => Promise.resolve({ ok: false, detail: "not drawn here" }),
  };
  const check: DriveCheck = {
    routes,
    alert: () => Promise.resolve(),
    settings: LOCAL_SETTINGS,
    refused: (detail) => {
      told.push(`refused: ${detail}`);
      return Promise.resolve();
    },
    answered: () => {
      told.push("answered");
      return Promise.resolve();
    },
    tooTight: (short) => {
      tight.push(short);
    },
  };
  return { check, asked, told, tight };
}

beforeEach(async () => {
  await markDatabase();
});

describe("Google's drives", () => {
  it("hold a start only where the drive from the visit before, and parking, reach it", async () => {
    const { check, asked, tight } = google(30);
    const plan = { day: dayAt(28.41), rules: RULES, now: NOW };
    const visit = { minutes: 60, pin: { lat: 28.43, lng: 77.05 } };
    // Wrapped up by 11:40, then 30 minutes' drive and 10 to park: not by noon, by 12:30.
    expect(await drivesFit(env.DB, check, plan, { ...visit, time: "12:00" })).toBe(false);
    // Google's 40 with parking, beside the estimate's for the same road at 11, and 20 past the gap noon left.
    expect(tight).toEqual([
      {
        leg: "before",
        google_minutes: 40,
        estimate_minutes: driveMinutes({ lat: 28.41, lng: 77.05 }, visit.pin, 11, DRIVE_ESTIMATE),
        past_gap_minutes: 20,
      },
    ]);
    expect(await drivesFit(env.DB, check, plan, { ...visit, time: "12:30" })).toBe(true);
    // The same road twice is Google's once: the answer is kept.
    expect(asked).toEqual([2]);
  });

  // The estimate a start is offered on is the hour the stop before it ends, not the hour its wrap-up does.
  it("tell the estimate of the hour the stop before ends, where its wrap-up runs into the next", async () => {
    const { check, tight } = google(30);
    const day: PlanDay = {
      ...dayAt(28.43),
      stops: [{ start: minuteOf("09:55"), end: minuteOf("10:55"), pin: { lat: 28.43, lng: 77.05 }, fit: false }],
    };
    const visit = { minutes: 60, pin: { lat: 28.47, lng: 77.05 }, time: "11:30" };
    expect(await drivesFit(env.DB, check, { day, rules: RULES, now: NOW }, visit)).toBe(false);
    expect(tight[0]?.estimate_minutes).toBe(driveMinutes({ lat: 28.43, lng: 77.05 }, visit.pin, 10, DRIVE_ESTIMATE));
  });

  it("hold a start only where the drive on to the visit after it, and parking, reach that one", async () => {
    const { check, tight } = google(30);
    const plan = { day: dayAt(28.42), rules: RULES, now: NOW };
    const visit = { minutes: 60, pin: { lat: 28.44, lng: 77.05 } };
    // Done by 10, wrapped up by 10:10, then 40 with parking: 50 past the visit at 10.
    expect(await drivesFit(env.DB, check, plan, { ...visit, time: "09:00" })).toBe(false);
    expect(tight).toEqual([
      {
        leg: "after",
        google_minutes: 40,
        estimate_minutes: driveMinutes(visit.pin, { lat: 28.42, lng: 77.05 }, 10, DRIVE_ESTIMATE),
        past_gap_minutes: 50,
      },
    ]);
  });

  it("leave the estimate standing where Google cannot answer, or the visit has no pin", async () => {
    const plan = { day: dayAt(28.45), rules: RULES, now: NOW };
    const down = google(null);
    expect(
      await drivesFit(env.DB, down.check, plan, { minutes: 60, pin: { lat: 28.47, lng: 77.05 }, time: "11:50" }),
    ).toBe(true);
    const unpinned = google(30);
    expect(await drivesFit(env.DB, unpinned.check, plan, { minutes: 60, pin: null, time: "11:50" })).toBe(true);
    expect(unpinned.asked).toEqual([]);
  });

  it("tell ops why Google refused, still holding on the estimate, and that it answers again", async () => {
    const plan = { day: dayAt(28.45), rules: RULES, now: NOW };
    const visit = { minutes: 60, pin: { lat: 28.47, lng: 77.05 }, time: "11:50" };
    const blocked = google(null, "HTTP 403: PERMISSION_DENIED, Requests to this API are blocked.");
    expect(await drivesFit(env.DB, blocked.check, plan, visit)).toBe(true);
    expect(blocked.told).toEqual(["refused: HTTP 403: PERMISSION_DENIED, Requests to this API are blocked."]);
    const down = google(null);
    await drivesFit(env.DB, down.check, plan, visit);
    expect(down.told).toEqual([]);
    const back = google(5);
    await drivesFit(env.DB, back.check, plan, visit);
    expect(back.told).toEqual(["answered"]);
  });
});
