// The sample day on the plan (docs/decisions/0210-booking-by-start-time.md): a first fit at 9:30 and a service visit
// at 1:30, and where a one-hour consultation and a three-hour fit can start after them. Pins sit due north of home, a
// kilometre a minute, so each drive is as long as the distance.

import { describe, expect, it } from "vitest";
import {
  breakFits,
  minuteOf,
  placedAt,
  placements,
  timeOf,
  type PlanDay,
  type PlanRules,
  type VisitToPlan,
} from "../../../src/policy/day-plan.ts";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { BOOKING_RULES } from "../../../src/policy/start-times.ts";

const HOME = { lat: 28.4, lng: 77.05 };
/** A pin `km` due north of home. */
const north = (km: number) => ({ lat: HOME.lat + km / 111.195, lng: HOME.lng });

const RULES: PlanRules = {
  booking: BOOKING_RULES,
  // 60 km/h all day, nothing to park: a minute a kilometre.
  drive: { ...DRIVE_ESTIMATE, road_factor: 100, peak_kmh: 60, offpeak_kmh: 60, parking: 0, least: 10 },
};

const DAY: PlanDay = {
  opens: minuteOf("09:00"),
  closes: minuteOf("20:00"),
  home: HOME,
  stops: [
    { start: minuteOf("09:30"), end: minuteOf("12:30"), pin: north(25), fit: true },
    { start: minuteOf("13:30"), end: minuteOf("15:00"), pin: north(50), fit: false },
  ],
  away: [],
};

const CONSULTATION = { minutes: 60, pin: north(70), fit: false };
const FIT = { minutes: 180, pin: north(70), fit: true };

const startsOf = (day: PlanDay, visit: VisitToPlan) =>
  placements(day, visit, RULES, 0).map((placed) => timeOf(placed.start));

describe("a day's starts", () => {
  it("offer a consultation from 4 pm, once the break and the drive are behind the service visit, to 6:30", () => {
    expect(startsOf(DAY, CONSULTATION)).toEqual(["16:00", "16:30", "17:00", "17:30", "18:00", "18:30"]);
  });

  it("offer a three-hour fit only at 4 and 4:30, so it ends with its wrap-up by 8", () => {
    expect(startsOf(DAY, FIT)).toEqual(["16:00", "16:30"]);
  });

  it("count the drive the visit adds, less the drive it saves between its neighbours", () => {
    // From the service visit 20 minutes away, with nothing after it.
    expect(placedAt(DAY, CONSULTATION, minuteOf("16:00"), RULES)).toEqual({ start: minuteOf("16:00"), addedDrive: 20 });
    // Between home and the first visit: 10 there, 15 on to the first fit, less the 25 straight to it.
    const early = {
      ...DAY,
      stops: [{ ...DAY.stops[0], start: minuteOf("11:30"), end: minuteOf("14:30") }] as PlanDay["stops"],
    };
    expect(placedAt(early, { minutes: 60, pin: north(10), fit: false }, minuteOf("09:30"), RULES)).toEqual({
      start: minuteOf("09:30"),
      addedDrive: 0,
    });
  });

  it("start no earlier than the earliest asked for, on the step", () => {
    const empty = { ...DAY, stops: [] };
    expect(
      placements(empty, { minutes: 60, pin: null, fit: false }, RULES, minuteOf("17:10")).map((p) => timeOf(p.start)),
    ).toEqual(["17:30", "18:00", "18:30"]);
  });

  it("keep clear of leave over part of the day", () => {
    const away = { ...DAY, stops: [], away: [{ from: minuteOf("14:00"), to: minuteOf("18:00") }] };
    const starts = startsOf(away, { minutes: 60, pin: null, fit: false });
    expect(starts).not.toContain("13:00");
    expect(starts).toContain("12:30");
    expect(starts).toContain("18:00");
    expect(starts.some((start) => start >= "13:00" && start < "18:00")).toBe(false);
  });

  it("take no more visits, or fits, than the day's caps", () => {
    const full = { ...RULES, booking: { ...BOOKING_RULES, visits: 2 } };
    expect(placements(DAY, CONSULTATION, full, 0)).toEqual([]);
    const oneFit = { ...RULES, booking: { ...BOOKING_RULES, fits: 1 } };
    expect(placements(DAY, FIT, oneFit, 0)).toEqual([]);
    expect(placements(DAY, CONSULTATION, oneFit, 0)).not.toEqual([]);
  });

  it("never overlap a stop, its wrap-up included", () => {
    expect(placedAt(DAY, { minutes: 30, pin: north(25), fit: false }, minuteOf("12:30"), RULES)).toBeNull();
  });
});

describe("a day's break", () => {
  it("fits where a free span inside its hours is as long as it", () => {
    expect(breakFits(DAY, DAY.stops, RULES)).toBe(true);
    const tight = [...DAY.stops, { start: minuteOf("15:30"), end: minuteOf("20:00"), pin: north(50), fit: false }];
    expect(breakFits(DAY, tight, RULES)).toBe(false);
  });

  it("is owed by no day outside its hours, and by none when it is set to nothing", () => {
    const evening = { ...DAY, opens: minuteOf("16:00"), stops: [] };
    expect(breakFits(evening, [], RULES)).toBe(true);
    const none = { ...RULES, booking: { ...BOOKING_RULES, break: 0 } };
    expect(breakFits(DAY, [{ start: DAY.opens, end: DAY.closes - 10, pin: null, fit: false }], none)).toBe(true);
  });
});
