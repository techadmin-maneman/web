// The free plan's daily allowances, which staging and production share, and when ops are warned of them.

import { describe, expect, it } from "vitest";
import {
  ALLOWANCES,
  DAILY_ALLOWANCES,
  isNearlySpent,
  percentUsed,
  WARN_AT_PERCENT,
} from "../../src/policy/daily-allowances.ts";

describe("the daily allowances", () => {
  it("are the Workers Free plan's, as Cloudflare publishes them", () => {
    expect(DAILY_ALLOWANCES).toEqual({ queueOperations: 10_000, d1RowsRead: 5_000_000, d1RowsWritten: 100_000 });
    expect(ALLOWANCES).toEqual(["queueOperations", "d1RowsRead", "d1RowsWritten"]);
  });

  it("warns at 70% of each daily allowance", () => {
    expect(WARN_AT_PERCENT).toBe(70);
    expect(isNearlySpent("queueOperations", 6_999)).toBe(false);
    expect(isNearlySpent("queueOperations", 7_000)).toBe(true);
    expect(isNearlySpent("d1RowsRead", 3_499_999)).toBe(false);
    expect(isNearlySpent("d1RowsRead", 3_500_000)).toBe(true);
    expect(isNearlySpent("d1RowsWritten", 69_999)).toBe(false);
    expect(isNearlySpent("d1RowsWritten", 70_000)).toBe(true);
  });

  it("counts whole percents, rounding down, and past the limit", () => {
    expect(percentUsed("queueOperations", 0)).toBe(0);
    expect(percentUsed("queueOperations", 2_602)).toBe(26);
    expect(percentUsed("d1RowsWritten", 23_250)).toBe(23);
    expect(percentUsed("queueOperations", 12_000)).toBe(120);
  });
});
