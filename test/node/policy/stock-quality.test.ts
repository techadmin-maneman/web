// Failure rates and value at risk (src/policy/stock-quality.ts; docs/decisions/0188-failure-rates-and-value-at-risk.md).

import { describe, expect, it } from "vitest";
import { failureRatePercent, unusedByExpiry } from "../../../src/policy/stock-quality.ts";

describe("failure rates and value at risk", () => {
  it("give failures as a share of fits, to a tenth", () => {
    expect(failureRatePercent(1, 8)).toBe(12.5);
    expect(failureRatePercent(0, 0)).toBeNull();
  });

  it("leave what a place will not use before each lot expires, the soonest used first", () => {
    const lots = [
      { lotId: "late", quantity: 10, expiresOn: "2026-11-20" },
      { lotId: "soon", quantity: 10, expiresOn: "2026-10-01" },
    ];
    // A unit a day: 10 days to the first lot uses it all, 60 days to the second uses 50 more, so all of both.
    expect(unusedByExpiry(lots, 1, "2026-09-21")).toEqual(new Map());
    // A unit every five days: 2 of the first by its day, 10 more of the second by its.
    expect(unusedByExpiry(lots, 0.2, "2026-09-21")).toEqual(new Map([["soon", 8]]));
    expect(unusedByExpiry(lots, 0, "2026-09-21")).toEqual(
      new Map([
        ["soon", 10],
        ["late", 10],
      ]),
    );
  });
});
