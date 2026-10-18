// Google's word on the drives either side of a start (src/domain/booking/drive-check.ts): a start the free estimate
// offered is held only where Google's drive from the visit before, and the time to park, still reach it. Where Google
// cannot answer, the estimate stands. Every pin here is made up.

import { beforeEach, describe, expect, it } from "vitest";
import { drivesFit, type DriveCheck } from "../../../src/domain/booking/drive-check.ts";
import { minuteOf, type PlanDay, type PlanRules } from "../../../src/policy/day-plan.ts";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
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

/** Google, answering every drive in `minutes`, or failing. */
function google(minutes: number | null): { check: DriveCheck; asked: number[] } {
  const asked: number[] = [];
  const routes: RoutesProvider = {
    route: (stops) => {
      asked.push(stops.length);
      return Promise.resolve(
        minutes === null
          ? { ok: false, detail: "down" }
          : { ok: true, legs: stops.slice(1).map(() => ({ seconds: minutes * 60, meters: 1000 })), polyline: null },
      );
    },
    map: () => Promise.resolve({ ok: false, detail: "no map here" }),
  };
  return { check: { routes, alert: () => Promise.resolve(), settings: LOCAL_SETTINGS }, asked };
}

beforeEach(async () => {
  await markDatabase();
});

describe("Google's drives", () => {
  it("hold a start only where the drive from the visit before, and parking, reach it", async () => {
    const { check, asked } = google(30);
    const plan = { day: dayAt(28.41), rules: RULES, now: NOW };
    const visit = { minutes: 60, pin: { lat: 28.43, lng: 77.05 } };
    // Wrapped up by 11:40, then 30 minutes' drive and 10 to park: not by noon, by 12:30.
    expect(await drivesFit(env.DB, check, plan, { ...visit, time: "12:00" })).toBe(false);
    expect(await drivesFit(env.DB, check, plan, { ...visit, time: "12:30" })).toBe(true);
    // The same road twice is Google's once: the answer is kept.
    expect(asked).toEqual([2]);
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
});
