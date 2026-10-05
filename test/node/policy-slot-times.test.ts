// The times of a working day's half-slots, which ops set in the console (src/policy/slot-times.ts), each rule named
// by its own words.

import { describe, expect, it } from "vitest";
import { WINDOW_SLOT_MAP, WINDOW_TIMES } from "../../src/config/scheduling.ts";
import {
  DEFAULT_SLOT_TIMES,
  earliestAppliesFrom,
  firstUnitAfter,
  RULES,
  slotTimesProblems,
  unitAt,
  windowAt,
  windowTimesOf,
  type SlotTimes,
} from "../../src/policy/slot-times.ts";

const LATER: SlotTimes = {
  unitStarts: ["10:00", "11:00", "12:30", "13:30", "14:30", "15:30", "17:00", "18:30"],
  dayEnd: "21:00",
};

describe("a day's times", () => {
  it(RULES[0], () => {
    expect(windowTimesOf(DEFAULT_SLOT_TIMES)).toEqual(WINDOW_TIMES);
    expect(windowTimesOf(LATER)).toEqual({
      morning: { start: "10:00", end: "12:30" },
      afternoon: { start: "12:30", end: "17:00" },
      evening: { start: "17:00", end: "21:00" },
    });
    expect([windowAt("12:15", LATER), windowAt("12:30", LATER), windowAt("17:00", LATER)]).toEqual([
      "morning",
      "afternoon",
      "evening",
    ]);
    expect([unitAt("10:59", LATER), unitAt("11:00", LATER), unitAt("20:00", LATER)]).toEqual([0, 1, 7]);
  });

  it("names the first half-slot still to start after a time of day: none once the last has started", () => {
    expect(firstUnitAfter("09:58", DEFAULT_SLOT_TIMES)).toBe(1);
    // A half-slot starting at this very minute has started.
    expect(firstUnitAfter("10:30", DEFAULT_SLOT_TIMES)).toBe(2);
    expect(firstUnitAfter("06:00", LATER)).toBe(0);
    expect(firstUnitAfter("18:30", LATER)).toBe(8);
  });

  it("may be set only as eight starts in order, a day's end after them, all inside the day", () => {
    expect(slotTimesProblems(DEFAULT_SLOT_TIMES)).toEqual([]);
    expect(slotTimesProblems(LATER)).toEqual([]);
    expect(slotTimesProblems({ ...LATER, unitStarts: LATER.unitStarts.slice(1) })).toEqual(["not_eight_starts"]);
    expect(slotTimesProblems({ ...LATER, dayEnd: "9 pm" })).toEqual(["not_a_time"]);
    expect(
      slotTimesProblems({ ...LATER, unitStarts: ["10:00", "11:00", "11:00", ...LATER.unitStarts.slice(3)] }),
    ).toEqual(["not_in_order"]);
    expect(slotTimesProblems({ ...LATER, dayEnd: "18:00" })).toEqual(["not_in_order"]);
    expect(slotTimesProblems({ ...LATER, dayEnd: "22:30" })).toEqual(["outside_the_day"]);
    expect(slotTimesProblems({ ...LATER, unitStarts: ["05:30", ...LATER.unitStarts.slice(1)] })).toEqual([
      "outside_the_day",
    ]);
  });

  it(RULES[2], () => {
    // Half-hour half-slots: a 90-minute visit at 09:30 and another at 10:30 would overlap from 10:30 to 11:00.
    const halfHours: SlotTimes = {
      unitStarts: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"],
      dayEnd: "13:00",
    };
    expect(slotTimesProblems(halfHours)).toEqual(["half_slot_too_short"]);
    // One short half-slot is enough, the last one before the day's end included.
    expect(slotTimesProblems({ ...LATER, unitStarts: ["10:00", "10:44", ...LATER.unitStarts.slice(2)] })).toEqual([
      "half_slot_too_short",
    ]);
    expect(slotTimesProblems({ ...LATER, dayEnd: "19:00" })).toEqual(["half_slot_too_short"]);
    // Exactly 45 minutes is long enough.
    expect(slotTimesProblems({ ...LATER, unitStarts: ["10:00", "10:45", ...LATER.unitStarts.slice(2)] })).toEqual([]);
    expect(slotTimesProblems({ ...LATER, dayEnd: "19:15" })).toEqual([]);
  });
});

describe("when a change of times may apply from", () => {
  it(RULES[1], () => {
    // Nothing booked: the day after the last a client can book, 45 days from tomorrow.
    expect(earliestAppliesFrom("2026-10-01", 45, null, null)).toBe("2026-11-16");
    // A visit booked further out, or a change already set further out, pushes it past them.
    expect(earliestAppliesFrom("2026-10-01", 45, "2026-12-01", null)).toBe("2026-12-02");
    expect(earliestAppliesFrom("2026-10-01", 45, null, "2027-01-01")).toBe("2027-01-02");
    // A visit booked inside the horizon changes nothing.
    expect(earliestAppliesFrom("2026-10-01", 45, "2026-10-20", null)).toBe("2026-11-16");
  });
});

// The client app offers three windows; a technician's day is eight half-slots. The two designs disagree, so the map
// between them is written down (docs/decisions/0035-window-slot-map.md).
describe("the client's windows", () => {
  it("are 9 to 12, 12 to 4 and 4 to 8, mapped onto the day's eight half-slots", () => {
    expect(WINDOW_TIMES).toEqual({
      morning: { start: "09:00", end: "12:00" },
      afternoon: { start: "12:00", end: "16:00" },
      evening: { start: "16:00", end: "20:00" },
    });
    expect(WINDOW_SLOT_MAP).toEqual({ morning: [0, 1], afternoon: [2, 3, 4, 5], evening: [6, 7] });
  });

  it("puts a time of day in India in the window it falls in, each window starting where the last one ends", () => {
    const inWindow = (time: string) => windowAt(time, DEFAULT_SLOT_TIMES);
    expect(inWindow("09:00")).toBe("morning");
    expect(inWindow("11:59")).toBe("morning");
    expect(inWindow("12:00")).toBe("afternoon");
    expect(inWindow("15:59")).toBe("afternoon");
    expect(inWindow("16:00")).toBe("evening");
    expect(inWindow("19:30")).toBe("evening");
  });
});
