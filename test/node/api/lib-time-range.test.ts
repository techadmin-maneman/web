// A time of day and a stretch of one as the client reads them (src/lib/time-range.ts): one style on every surface.

import { describe, expect, it } from "vitest";
import { timeOfDay, timeRange, UNBROKEN } from "../../../src/lib/time-range.ts";

describe("a time of day", () => {
  it("says the hour, its minutes where it has any, and noon and midnight by name", () => {
    expect(timeOfDay("09:00")).toBe("9 am");
    expect(timeOfDay("21:30")).toBe("9:30 pm");
    expect(timeOfDay("12:00")).toBe("12 noon");
    expect(timeOfDay("00:00")).toBe("12 midnight");
  });
});

// The windows read "9 am to 12 pm" while Care's hours read "9 am–9 pm" and the after-hours answer "noon".
describe("a stretch of the day", () => {
  it("joins its ends with an en dash, saying the half of the day once where both share it", () => {
    expect(timeRange("09:00", "12:00")).toBe("9 am–12 noon");
    expect(timeRange("12:00", "16:00")).toBe("12–4 pm");
    expect(timeRange("16:00", "20:00")).toBe("4–8 pm");
    expect(timeRange("09:00", "21:00")).toBe("9 am–9 pm");
    expect(timeRange("10:00", "12:30")).toBe("10 am–12:30 pm");
  });

  it("keeps am and pm with their hour on a screen", () => {
    expect(timeRange("12:00", "16:00", UNBROKEN)).toBe("12–4\u00a0pm");
  });
});
