// How right the forecast was (src/policy/forecast-accuracy.ts; docs/decisions/0183-forecast-accuracy.md).

import { describe, expect, it } from "vitest";
import { biasPercent, errorPercent, withinHighPercent } from "../../../src/policy/forecast-accuracy.ts";

const LINES = [
  { expected: 10, high: 15, actual: 12 },
  { expected: 6, high: 10, actual: 4 },
  { expected: 0, high: 0, actual: 4 },
];

describe("the forecast's accuracy", () => {
  it("is each miss over what was used, the bias keeping its sign, and the share within the high case", () => {
    expect(errorPercent(LINES)).toBe(40);
    expect(biasPercent(LINES)).toBe(-20);
    expect(withinHighPercent(LINES)).toBe(67);
  });

  it("says nothing where nothing was used or nothing was measured", () => {
    expect(errorPercent([{ expected: 3, high: 6, actual: 0 }])).toBeNull();
    expect(biasPercent([])).toBeNull();
    expect(withinHighPercent([])).toBeNull();
  });
});
