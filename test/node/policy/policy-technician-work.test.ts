// Board D3's two figures (src/policy/technician-work.ts): how far back a technician's jobs are counted, and how far
// over its planned length an average reads as running over, in the owner's words.

import { describe, expect, it } from "vitest";
import { OVER_BY_MIN, runsOver, WORK_PERIOD_DAYS } from "../../../src/policy/technician-work.ts";

describe("board D3", () => {
  it("flags a technician whose average over 90 days runs 15 minutes over the plan", () => {
    expect(WORK_PERIOD_DAYS).toBe(90);
    expect(OVER_BY_MIN).toBe(15);
    expect(runsOver({ average: 105, planned: 90 })).toBe(true);
    expect(runsOver({ average: 104, planned: 90 })).toBe(false);
  });

  it("runs over from as many minutes as ops set", () => {
    expect(runsOver({ average: 105, planned: 90 }, 20)).toBe(false);
    expect(runsOver({ average: 110, planned: 90 }, 20)).toBe(true);
  });
});
