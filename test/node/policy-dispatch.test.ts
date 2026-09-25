// The dispatch board's clash check and move reasons, each rule named by the
// prompt's own words (src/policy/dispatch.ts).

import { describe, expect, it } from "vitest";
import { SLOTS_PER_DAY, UNITS_PER_DAY, VISIT_BLOCKS, type BookingWindow } from "../../src/config/scheduling.ts";
import { clashes, isMoveReason, MOVE_REASONS, moveRefusal, RULES, slotsFor } from "../../src/policy/dispatch.ts";

/** A technician whose day already holds a job starting in each of these windows. */
const day = (...windows: BookingWindow[]) => ({ windows: new Set(windows), onLeave: false });
/** The same technician, away that day (ADR 0062). */
const away = (...windows: BookingWindow[]) => ({ ...day(...windows), onLeave: true });

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

  it("books each visit for the length the owner ruled on 24 September 2026", () => {
    // What FSM holds the appointment for, and what a technician's day is
    // measured against (docs/open-points.md, "Visit lengths").
    expect(VISIT_BLOCKS.consultation.minutes).toBe(60);
    expect(VISIT_BLOCKS.service.minutes).toBe(90);
    expect(VISIT_BLOCKS.replacement.minutes).toBe(135);
    expect(VISIT_BLOCKS.first_fit.minutes).toBe(180);
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

  // The rule the prompt's last line asks for, kept our way (ADR 0062): the day
  // is refused outright, and named as leave so ops are not told it is merely full.
  it("refuses every window of a day the technician is away, and says it is leave", () => {
    expect(moveRefusal(away(), "morning", "client_asked")).toBe("on_leave");
    expect(moveRefusal(away(), "afternoon", "zone_rebalance")).toBe("on_leave");
    expect(moveRefusal(away(), "evening", "running_over")).toBe("on_leave");
    // An empty window on a day off is still leave, not a clash.
    expect(moveRefusal(away("evening"), "morning", "client_asked")).toBe("on_leave");
  });

  // "A visit fits where every half-slot of its block is free" (ADR 0034), and "a
  // visit may run on past its window's end, but not past the day's last
  // half-slot, so a first fit cannot start in the evening" (ADR 0035). A window
  // nobody holds can still have no room, and ops are told that, not that it clashes.
  it("refuses a job with no room in a free window as not fitting, not as a clash", () => {
    expect(moveRefusal(day(), "evening", "client_asked", { fits: false })).toBe("does_not_fit");
    expect(moveRefusal(day(), "evening", "client_asked", { fits: true })).toBeNull();
    // A window someone holds is still a clash, and a day off still leave, whatever the room.
    expect(moveRefusal(day("evening"), "evening", "client_asked", { fits: false })).toBe("clash");
    expect(moveRefusal(away(), "evening", "client_asked", { fits: false })).toBe("on_leave");
  });
});
