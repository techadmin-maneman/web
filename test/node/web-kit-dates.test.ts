import { describe, expect, it } from "vitest";
import { longDate, shortDate } from "../../packages/web-kit/dates.ts";

describe("web-kit dates", () => {
  it.each([
    ["2026-09-24", "Thu 24 Sep"],
    ["2026-09-21", "Mon 21 Sep"],
    ["2027-01-02", "Sat 2 Jan"],
  ])("writes the calendar date %s as the design does: %s", (date, written) => {
    expect(shortDate(date)).toBe(written);
  });

  it.each([
    ["2026-11-14T08:00:00Z", "14 Nov 2026"],
    // Past 18:30 UTC it is already the next day in India.
    ["2026-11-13T18:45:00Z", "14 Nov 2026"],
    ["2026-12-31T19:00:00Z", "1 Jan 2027"],
  ])("writes the instant %s as India's date: %s", (instant, written) => {
    expect(longDate(instant)).toBe(written);
  });
});
