// Where a move by ops lands on the technician's day (src/domain/dispatch/dispatch-landing.ts), and why one cannot: a
// time gone first, then a day away, then the technician beside the client's visit, then a visit already at that time,
// then no room, and a blacked-out day only once nothing else stands in the way.

import { describe, expect, it } from "vitest";
import { landingOf, timesAt } from "../../../src/domain/dispatch/dispatch-landing.ts";
import { minuteOf, type PlanDay, type PlanRules } from "../../../src/policy/day-plan.ts";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { BOOKING_RULES } from "../../../src/policy/start-times.ts";

const RULES: PlanRules = { booking: BOOKING_RULES, drive: DRIVE_ESTIMATE };
const PIN = { lat: 28.45, lng: 77.05 };

/** A day from 9 to 8 with a service visit from 10 to 11:30. */
const DAY: PlanDay = {
  opens: minuteOf("09:00"),
  closes: minuteOf("20:00"),
  home: null,
  stops: [{ start: minuteOf("10:00"), end: minuteOf("11:30"), pin: PIN, fit: false }],
  away: [],
};
const SERVICE = { minutes: 90, pin: PIN, fit: false };

/** A move to 22 October, to the morning's earliest start with room or to `start`. */
const target = (start: string | null, time: "ahead" | "past_day" | "window_passed" = "ahead") => ({
  technicianId: "t-1",
  date: "2026-10-22",
  window: "morning" as const,
  keepsTime: false,
  start: start === null ? null : minuteOf(start),
  earliest: 0,
  hours: { from: minuteOf("09:00"), to: minuteOf("12:00") },
  time,
});

const land = (
  start: string | null,
  bars: { day?: PlanDay | null; time?: "ahead" | "past_day"; blackout?: boolean; beside?: boolean } = {},
) =>
  landingOf({
    day: bars.day === undefined ? DAY : bars.day,
    job: SERVICE,
    target: target(start, bars.time),
    rules: RULES,
    blackoutWithoutReason: bars.blackout ?? false,
    beside: bars.beside ?? false,
  });

describe("a move", () => {
  it("lands at the start asked for where the day has room, and at the window's earliest that does", () => {
    expect(land("15:00")).toEqual({ kind: "lands", start: minuteOf("15:00") });
    // 9:00 runs into the 10:00 visit; the morning's next start clear of it and its drive is noon, past the window.
    expect(land(null)).toEqual({ kind: "refused", reason: "does_not_fit" });
    expect(land(null, { day: { ...DAY, stops: [] } })).toEqual({ kind: "lands", start: minuteOf("09:00") });
  });

  it("names a start a visit already takes as a clash, and one with no room for the drive or the day as not fitting", () => {
    expect(land("10:30")).toEqual({ kind: "refused", reason: "clash" });
    expect(land("09:00")).toEqual({ kind: "refused", reason: "clash" });
    expect(land("11:30")).toEqual({ kind: "refused", reason: "does_not_fit" });
    expect(land("19:00")).toEqual({ kind: "refused", reason: "does_not_fit" });
  });

  it("answers a time gone before anything else, then a day away, then the client's visit beside it", () => {
    expect(land("15:00", { time: "past_day", day: null, beside: true })).toEqual({
      kind: "refused",
      reason: "past_day",
    });
    expect(land("15:00", { day: null, beside: true })).toEqual({ kind: "refused", reason: "on_leave" });
    expect(land("10:30", { beside: true })).toEqual({ kind: "refused", reason: "back_to_back" });
    expect(land("10:30", { blackout: true })).toEqual({ kind: "refused", reason: "clash" });
  });

  it("refuses a blacked-out day without a reason only where the visit would otherwise land", () => {
    expect(land("15:00", { blackout: true })).toEqual({ kind: "refused", reason: "blackout" });
    expect(land("11:30", { blackout: true })).toEqual({ kind: "refused", reason: "does_not_fit" });
  });

  it("starts and ends on India's clock where it lands", () => {
    const times = timesAt(target("15:00"), minuteOf("15:00"), 90);
    expect(times.start.toISOString()).toBe("2026-10-22T09:30:00.000Z");
    expect(times.end.toISOString()).toBe("2026-10-22T11:00:00.000Z");
  });
});
