// The dispatch board's clash check and move reasons, each rule named by the
// prompt's own words (src/policy/dispatch.ts).

import { describe, expect, it } from "vitest";
import { SLOTS_PER_DAY, UNITS_PER_DAY, type BookingWindow } from "../../src/config/scheduling.ts";
import { clashes, isMoveReason, MOVE_REASONS, moveRefusal, RULES, slotsFor } from "../../src/policy/dispatch.ts";

/** A technician whose day already holds a job starting in each of these windows. */
const day = (...windows: BookingWindow[]) => ({ windows: new Set(windows) });

describe("dispatch", () => {
  it(RULES[0], () => {
    expect(SLOTS_PER_DAY).toBe(4);
    expect(UNITS_PER_DAY).toBe(8); // counted in halves, so a replacement's block is whole
  });

  it(RULES[1], () => {
    expect(slotsFor("consultation")).toBe(1);
    expect(slotsFor("service")).toBe(1);
    expect(slotsFor("replacement")).toBe(1.5);
    expect(slotsFor("first_fit")).toBe(2);
  });

  it(RULES[2], () => {
    expect(clashes(day("afternoon"), "afternoon")).toBe(true);
    expect(clashes(day("afternoon"), "morning")).toBe(false);
    expect(clashes(day(), "afternoon")).toBe(false);
    // Two jobs on one date is fine, as long as they are in different windows.
    expect(clashes(day("morning", "evening"), "afternoon")).toBe(false);
  });

  it(RULES[3], () => {
    expect([...MOVE_REASONS]).toEqual([
      "technician_unavailable",
      "client_asked",
      "zone_rebalance",
      "skill_needed",
      "running_over",
    ]);
    expect(isMoveReason("zone_rebalance")).toBe(true);
    expect(isMoveReason("because")).toBe(false);
  });

  it("refuses a move with no reason from the list, and one that clashes", () => {
    expect(moveRefusal(day(), "morning", "client_asked")).toBeNull();
    expect(moveRefusal(day(), "morning", "because")).toBe("unknown_reason");
    expect(moveRefusal(day("morning"), "morning", "client_asked")).toBe("clash");
    // The reason is checked first: a move nobody can explain is refused either way.
    expect(moveRefusal(day("morning"), "morning", "")).toBe("unknown_reason");
  });
});
