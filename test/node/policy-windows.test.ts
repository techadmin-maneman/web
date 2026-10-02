// The client's three windows against the board's four slots (src/policy/windows.ts), named by the prompt's own words.

import { describe, expect, it } from "vitest";
import { WINDOW_SLOT_MAP, WINDOW_TIMES } from "../../src/config/scheduling.ts";
import { DEFAULT_SLOT_TIMES, windowAt } from "../../src/policy/slot-times.ts";
import { RULES } from "../../src/policy/windows.ts";

describe("the windows", () => {
  it(RULES[0], () => {
    expect(WINDOW_TIMES).toEqual({
      morning: { start: "09:00", end: "12:00" },
      afternoon: { start: "12:00", end: "16:00" },
      evening: { start: "16:00", end: "20:00" },
    });
    expect(WINDOW_SLOT_MAP).toEqual({ morning: [0, 1], afternoon: [2, 3, 4, 5], evening: [6, 7] });
  });

  it("puts a time of day in India in the window it falls in, each window starting where the last one ends", () => {
    const inWindow = (time: string) => windowAt(time, DEFAULT_SLOT_TIMES);
    expect(inWindow("09:00")).toBe("morning");
    expect(inWindow("11:59")).toBe("morning");
    expect(inWindow("12:00")).toBe("afternoon");
    expect(inWindow("15:59")).toBe("afternoon");
    expect(inWindow("16:00")).toBe("evening");
    expect(inWindow("19:30")).toBe("evening");
  });
});
