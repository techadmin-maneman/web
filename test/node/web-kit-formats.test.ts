import { describe, expect, it } from "vitest";
import { fullDate, listDate, longDate, shortDate } from "../../packages/web-kit/dates.ts";
import { rupees } from "../../packages/web-kit/money.ts";

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

  it("writes a calendar date in full, and without this year's year in a list", () => {
    expect(fullDate("2027-08-22")).toBe("22 Aug 2027");
    expect(fullDate("2026-11-04")).toBe("4 Nov 2026");
    expect(listDate("2027-08-22", 2027)).toBe("22 Aug");
    expect(listDate("2026-11-14", 2027)).toBe("14 Nov 2026");
  });
});

describe("web-kit money", () => {
  it.each([
    [200000, "Rs. 2,000"],
    [3540000, "Rs. 35,400"],
    [10000000, "Rs. 1,00,000"],
    [235932, "Rs. 2,359.32"],
    [0, "Rs. 0"],
  ])("writes %i paise as the design does: %s", (paise, written) => {
    expect(rupees(paise)).toBe(written);
  });
});
