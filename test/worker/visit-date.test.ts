import { describe, expect, it } from "vitest";
import { windowLabel } from "../../src/config/booking.ts";
import { candidateRange, proposeVisitDate } from "../../src/domain/visit-date.ts";
import { addDays, indiaDate, indiaHour, isWeekend } from "../../src/lib/india-time.ts";
import { toE164 } from "../../src/lib/mobile.ts";

const none = new Set<string>();

describe("India dates", () => {
  it("rolls over at midnight in India, not in UTC", () => {
    expect(indiaDate(new Date("2026-09-21T18:29:59Z"))).toBe("2026-09-21"); // 23:59:59 IST
    expect(indiaDate(new Date("2026-09-21T18:30:00Z"))).toBe("2026-09-22"); // 00:00 IST
    expect(indiaHour(new Date("2026-09-21T18:30:00Z"))).toBe("2026-09-22T00");
  });

  it("adds days across month ends and knows weekends", () => {
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
    expect(isWeekend("2026-09-26")).toBe(true); // Saturday
    expect(isWeekend("2026-09-27")).toBe(true); // Sunday
    expect(isWeekend("2026-09-28")).toBe(false); // Monday
  });
});

describe("proposeVisitDate", () => {
  const monday = new Date("2026-09-21T06:30:00Z");

  it("is at least the lead time away, on the chosen kind of day", () => {
    expect(proposeVisitDate(monday, "weekday_am", 2, none)).toBe("2026-09-23"); // Wednesday
    expect(proposeVisitDate(monday, "weekend_am", 2, none)).toBe("2026-09-26"); // Saturday
  });

  it("moves past the weekend for a weekday request made on a Thursday", () => {
    const thursday = new Date("2026-09-24T06:30:00Z");
    expect(proposeVisitDate(thursday, "weekday_pm", 2, none)).toBe("2026-09-28"); // Saturday skipped to Monday
  });

  it("uses the India date: 11 pm UTC on Monday is already Tuesday", () => {
    expect(proposeVisitDate(new Date("2026-09-21T23:00:00Z"), "weekday_am", 2, none)).toBe("2026-09-24");
  });

  it("skips blackout days, and gives up when every candidate is blacked out", () => {
    expect(proposeVisitDate(monday, "weekday_am", 2, new Set(["2026-09-23", "2026-09-24"]))).toBe("2026-09-25");

    const range = candidateRange(monday, 2);
    const everything = new Set<string>();
    for (let date = range.from; date <= range.to; date = addDays(date, 1)) everything.add(date);
    expect(proposeVisitDate(monday, "weekday_am", 2, everything)).toBeNull();
  });

  it("labels mornings and evenings as the design does", () => {
    expect(windowLabel("weekday_am")).toBe("before noon");
    expect(windowLabel("weekend_pm")).toBe("after four");
  });
});

describe("toE164", () => {
  it.each([
    ["9810000000", "+919810000000"],
    ["98100 00000", "+919810000000"],
    ["+91 98100-00000", "+919810000000"],
    ["+919810000000", "+919810000000"],
    ["098100 00000", "+919810000000"],
    ["6000000000", "+916000000000"],
  ])("accepts %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(["5810000000", "981000000", "98100000000", "+1 9810000000", "0124 4000000", "98100 0000a"])(
    "rejects %s",
    (input) => {
      expect(toE164(input)).toBeNull();
    },
  );
});
