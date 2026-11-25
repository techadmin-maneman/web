// A setting that is a time of the day (docs/decisions/0322-care-times.md): shown as a clock in its box, typed back as
// one, and read in words, so Care may open at 9:30 (apps/ops/src/settings/rule-drafts.ts).

import { describe, expect, it } from "vitest";
import { MINUTE_OF_DAY } from "../../src/config/setting-units.ts";
import { clockText, minuteOf, rangeWords, READ_AS } from "../../apps/ops/src/settings/rule-drafts.ts";

describe("a time of the day", () => {
  it("is shown as a clock, and typed back as one", () => {
    expect(clockText(570)).toBe("09:30");
    expect(minuteOf("09:30", 0, 1439)).toBe(570);
    expect(minuteOf("9:30", 0, 1439)).toBe(570);
  });

  it("refuses what is no time, or one outside its bounds", () => {
    expect(minuteOf("9.30", 0, 1439)).toBeNull();
    expect(minuteOf("09:75", 0, 1439)).toBeNull();
    expect(minuteOf("00:00", 1, 1439)).toBeNull();
  });

  it("is read in words, the half hour included", () => {
    const say = READ_AS[MINUTE_OF_DAY]?.say;
    expect(say?.(570)).toBe("9:30 am");
    expect(say?.(1140)).toBe("7 pm");
    expect(say?.(720)).toBe("noon");
    expect(rangeWords({ min: 0, max: 1439, unit: MINUTE_OF_DAY })).toBe("midnight to 11:59 pm, as a time of day");
  });
});
