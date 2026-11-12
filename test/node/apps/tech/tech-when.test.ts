// The technician app's clock (apps/tech/src/lib/when.ts): the day it asks for,
// and the times and counts the boards write.

import { describe, expect, it } from "vitest";
import {
  arrival,
  clock,
  countdown,
  dayAfter,
  dayDate,
  dayMonth,
  lengthOf,
  metres,
  spanEnds,
  todayInIndia,
} from "../../../../apps/tech/src/lib/when.ts";

describe("the day", () => {
  it("is India’s, which is five and a half hours ahead of UTC", () => {
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
  // A 4 pm visit read "4:00" under "First at 9 am".
  it("writes a row’s time with am or pm, as the head of Today does", () => {
    expect(clock("2030-09-19T04:00:00.000Z")).toBe("9:30 am");
    expect(clock("2030-09-19T06:30:00.000Z")).toBe("12 pm");
    expect(clock("2030-09-19T10:30:00.000Z")).toBe("4 pm");
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

describe("the days and spans the design writes", () => {
  it("writes a day with its weekday and a comma, and nothing for a field left empty", () => {
    expect(dayDate("2026-11-12")).toBe("Thu, 12 Nov");
    expect(dayDate("")).toBe("");
  });

  it("writes a span's month once where both days share it, and both across a month or a year", () => {
    expect(spanEnds("2026-11-12", "2026-11-18")).toEqual(["12", "18 Nov"]);
    expect(spanEnds("2026-11-28", "2026-12-04")).toEqual(["28 Nov", "4 Dec"]);
    expect(spanEnds("2026-12-29", "2027-01-04")).toEqual(["29 Dec", "4 Jan"]);
  });

  it("writes the arrival window with to, as the rest of the app does", () => {
    const at = (time: string) => new Date(`2026-11-12T${time}:00+05:30`).toISOString();
    expect(arrival({ starts_at: at("09:30"), arrives_by: at("10:00") })).toBe("9:30 to 10 am");
    expect(arrival({ starts_at: at("11:30"), arrives_by: at("12:30") })).toBe("11:30 am to 12:30 pm");
  });
});
