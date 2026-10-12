// Cycle counts' rules (src/policy/cycle-counts.ts; docs/decisions/0185-cycle-counts.md).

import { describe, expect, it } from "vitest";
import { classOf, needsRecount } from "../../../src/policy/cycle-counts.ts";

describe("cycle counts", () => {
  it("count a hair system weekly and the rest quarterly, until ops set a class", () => {
    expect(classOf(null, true)).toBe("weekly");
    expect(classOf(null, false)).toBe("quarterly");
    expect(classOf("monthly", false)).toBe("monthly");
  });

  it("count again any piece that differs, and a consumable past the tolerance", () => {
    expect(needsRecount(4, 5, true)).toBe(true);
    expect(needsRecount(5, 5, true)).toBe(false);
    expect(needsRecount(96, 100, false)).toBe(false);
    expect(needsRecount(94, 100, false)).toBe(true);
    expect(needsRecount(2, 3, false)).toBe(false);
    expect(needsRecount(1, 3, false)).toBe(true);
  });
});
