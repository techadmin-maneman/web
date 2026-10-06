// India's calendar, the first form's window words, and a mobile number as typed.

import { describe, expect, it } from "vitest";
import { windowLabel } from "../../../src/config/booking.ts";
import { addDays, indiaDate, indiaHour, isWeekend } from "../../../src/lib/india-time.ts";
import { mobileDigits } from "../../../packages/web-kit/mobile.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../../src/lib/mobile.ts";

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

describe("windowLabel", () => {
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
    ["+91 98765 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["91-9876543210", "+919876543210"],
    ["9198765432", "+919198765432"],
  ])("accepts %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(["5810000000", "981000000", "98100000000", "+1 9810000000", "0124 4000000", "98100 0000a"])(
    "rejects %s",
    (input) => {
      expect(toE164(input)).toBeNull();
    },
  );

  // The site and the apps send what they read; the API must keep the same number, never a different one.
  it.each([
    "+91 98765 43210",
    "+919876543210",
    "919876543210",
    "09876543210",
    "0091 98765 43210",
    "91-9876543210",
    "9876543210",
    "0124 4000000",
    "98765 4321",
    "58765 43210",
  ])("reads %s as the site and the apps do", (typed) => {
    const digits = mobileDigits(typed);
    expect(toE164(typed)).toBe(digits === null ? null : `+91${digits}`);
  });

  it.each(["+91 98765 43210", "919876543210", "09876543210", "0091 98765 43210", "91-9876543210"])(
    "takes %s as the API's input",
    (typed) => {
      expect(INDIAN_MOBILE_PATTERN.test(typed)).toBe(true);
    },
  );
});
