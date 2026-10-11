// What Customer Care give without a manager (src/policy/remedies.ts; docs/decisions/0143-remedies.md).

import { describe, expect, it } from "vitest";
import { REMEDY_LIMIT, withinLimit } from "../../../src/policy/remedies.ts";

describe("the remedy limit", () => {
  it("lets one free visit go at once in 90 days, and sends more to a manager", () => {
    expect(REMEDY_LIMIT).toEqual({ visits: 1, days: 90 });
    expect(withinLimit(1, 0)).toBe(true);
    expect(withinLimit(1, 1)).toBe(false);
    expect(withinLimit(2, 0)).toBe(false);
    expect(withinLimit(2, 1, { visits: 3, days: 30 })).toBe(true);
  });
});
