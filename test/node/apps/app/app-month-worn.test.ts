// Which month of its life a hair system is in, as Home's hair system counts it (apps/app/src/home/month-worn.ts):
// from 1 on the day it is fitted, a month more on the same day of each month after.

import { describe, expect, it } from "vitest";
import { monthWorn } from "../../../../apps/app/src/home/month-worn.ts";

describe("the month a hair system is in", () => {
  it("is the first from the day it is fitted until the same day a month on", () => {
    expect(monthWorn("2026-03-14", "2026-03-14")).toBe(1);
    expect(monthWorn("2026-03-14", "2026-04-13")).toBe(1);
    expect(monthWorn("2026-03-14", "2026-04-14")).toBe(2);
  });

  it("counts across the turn of a year", () => {
    expect(monthWorn("2026-11-20", "2027-02-19")).toBe(3);
    expect(monthWorn("2026-11-20", "2027-02-20")).toBe(4);
  });

  it("is never below the first, for a day before the fit's own", () => {
    expect(monthWorn("2026-03-14", "2026-03-01")).toBe(1);
  });
});
