// The demand forecast's rules (src/policy/forecast.ts; docs/decisions/0179-demand-forecast.md).

import { describe, expect, it } from "vitest";
import { expectedOf, highOf, learnedRate, periodOf } from "../../../src/policy/forecast.ts";

describe("the forecast", () => {
  it("expects what is booked, due and in the pipeline, or the item's own history where that is more", () => {
    expect(expectedOf({ booked: 3, due: 2.4, pipeline: 1.25, baseline: 4 })).toBe(6.7);
    expect(expectedOf({ booked: 1, due: 0, pipeline: 0, baseline: 5.5 })).toBe(5.5);
  });

  it("runs its high case about one period in twenty above the expected", () => {
    expect(highOf(4)).toBe(7.3);
    expect(highOf(0)).toBe(0);
  });

  it("learns a rate from enough cases, and falls back before there are", () => {
    expect(learnedRate(18, 24, 0.8)).toBe(0.75);
    expect(learnedRate(2, 3, 0.8)).toBe(0.8);
    expect(learnedRate(30, 20, 0.5)).toBe(1);
  });

  it("puts a day in its period of the horizon, and none outside it", () => {
    expect(periodOf("2026-09-21", "2026-09-21", 7, 12)).toBe(0);
    expect(periodOf("2026-09-28", "2026-09-21", 7, 12)).toBe(1);
    expect(periodOf("2026-12-14", "2026-09-21", 7, 12)).toBeNull();
    expect(periodOf("2026-09-20", "2026-09-21", 7, 12)).toBeNull();
  });
});
