// The technician app's clock (apps/tech/src/lib/when.ts): the day it asks for,
// and the times and counts the boards write.

import { describe, expect, it } from "vitest";
import {
  clockShort,
  countdown,
  dayAfter,
  dayMonth,
  lengthOf,
  metres,
  todayInIndia,
} from "../../apps/tech/src/lib/when.ts";

describe("the day", () => {
  it("is India's, which is five and a half hours ahead of UTC", () => {
    expect(todayInIndia(new Date("2030-09-19T18:29:59Z"))).toBe("2030-09-19");
    expect(todayInIndia(new Date("2030-09-19T18:30:00Z"))).toBe("2030-09-20");
  });

  it("turns over at the end of a month and a year", () => {
    expect(dayAfter("2030-09-30")).toBe("2030-10-01");
    expect(dayAfter("2030-12-31")).toBe("2031-01-01");
  });

  it("is written as board A3 dates the last visit", () => {
    expect(dayMonth("2030-08-22")).toBe("22 Aug");
    expect(dayMonth("2030-01-05")).toBe("5 Jan");
  });
});

describe("the times and counts", () => {
  it("writes a row's time without am or pm (board A1)", () => {
    expect(clockShort("2030-09-19T04:00:00.000Z")).toBe("9:30");
    expect(clockShort("2030-09-19T06:30:00.000Z")).toBe("12:00");
  });

  it("counts the wait in whole minutes and seconds, and never below nothing", () => {
    expect(countdown(11 * 60_000 + 42_000)).toBe("11:42");
    expect(countdown(1)).toBe("0:01");
    expect(countdown(-5_000)).toBe("0:00");
  });

  it("measures the distance in metres, then kilometres", () => {
    expect(metres(40)).toBe("40 m");
    expect(metres(1400)).toBe("1.4 km");
  });

  it("times a job in hours and minutes, and never backwards", () => {
    expect(lengthOf(0, 82 * 60_000)).toEqual({ hours: 1, minutes: 22 });
    expect(lengthOf(60_000, 0)).toEqual({ hours: 0, minutes: 0 });
  });
});
