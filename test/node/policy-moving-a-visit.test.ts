// Moving or cancelling a visit, each rule named by the prompt's own words (src/policy/moving-a-visit.ts).

import { describe, expect, it } from "vitest";
import { cancelRefund, freeUntil, moveCost, noticeAt, RULES } from "../../src/policy/moving-a-visit.ts";

/** A window starting at noon on Thursday 24 September, in India. */
const WINDOW = new Date("2026-09-24T06:30:00Z");
const hoursBefore = (hours: number) => new Date(WINDOW.getTime() - hours * 3_600_000);

describe("moving a visit", () => {
  it(RULES[0], () => {
    expect(freeUntil(WINDOW)).toEqual(hoursBefore(24));
    expect(noticeAt(WINDOW, hoursBefore(24.01))).toBe("free");
    for (const type of ["consultation", "first_fit", "service", "replacement"] as const) {
      expect(moveCost(type, "free", "client")).toBe("free");
      expect(cancelRefund(type, "free")).toBe("all");
    }
  });

  it(`${RULES[1]} ${RULES[2]}`, () => {
    expect(noticeAt(WINDOW, hoursBefore(24))).toBe("late");
    expect(moveCost("service", "late", "client")).toBe("charged");
    expect(cancelRefund("service", "late")).toBe("none");
  });

  it(RULES[4], () => {
    expect(moveCost("first_fit", "late", "client")).toBe("late_fee");
    expect(cancelRefund("first_fit", "late")).toBe("all_but_fee");
  });

  it(RULES[5], () => {
    expect(moveCost("replacement", "late", "client")).toBe("late_fee");
    expect(cancelRefund("replacement", "late")).toBe("all_but_fee");
  });

  it(RULES[6], () => {
    for (const type of ["consultation", "first_fit", "service", "replacement"] as const) {
      expect(moveCost(type, "late", "ops")).toBe("free");
    }
  });

  it("leaves a free consultation free, whenever it moves or is cancelled", () => {
    expect(moveCost("consultation", "late", "client")).toBe("free");
    expect(cancelRefund("consultation", "late")).toBe("all");
  });
});
