// Usage against expected, and shrinkage (src/policy/stock-usage.ts; docs/decisions/0186-usage-and-shrinkage.md).

import { describe, expect, it } from "vitest";
import {
  countAccuracyPercent,
  kitFlagged,
  overPercent,
  shrinkagePercent,
  technicianFlagged,
} from "../../../src/policy/stock-usage.ts";

describe("usage and shrinkage", () => {
  it("flag a technician well over expected across enough visits", () => {
    expect(overPercent(130, 100)).toBe(30);
    expect(overPercent(80, 100)).toBe(-20);
    expect(overPercent(5, 0)).toBeNull();
    expect(technicianFlagged(30, 6)).toBe(true);
    expect(technicianFlagged(30, 3)).toBe(false);
    expect(technicianFlagged(15, 20)).toBe(false);
  });

  it("flag a kit that keeps needing write-offs, and give losses and first-time counts as shares", () => {
    expect(kitFlagged("kit", 3)).toBe(true);
    expect(kitFlagged("stockroom", 9)).toBe(false);
    expect(shrinkagePercent(5, 200)).toBe(2.5);
    expect(shrinkagePercent(1, 0)).toBeNull();
    expect(countAccuracyPercent(9, 12)).toBe(75);
    expect(countAccuracyPercent(0, 0)).toBeNull();
  });
});
