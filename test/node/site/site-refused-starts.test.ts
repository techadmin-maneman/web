// A start booking was refused at, shut on every read of the days after (site/src/lib/open-windows.ts): the API plans
// its starts on an estimate of the drives, and would offer the same start again, to be refused again.

import { describe, expect, it } from "vitest";
import { withoutRefused, type OpenDays } from "../../../site/src/lib/open-windows.ts";

const HOURS = {
  morning: { start: "09:00", end: "12:00" },
  afternoon: { start: "12:00", end: "16:00" },
  evening: { start: "16:00", end: "20:00" },
};

const days = [
  {
    date: "2026-10-03",
    windows: { morning: true, afternoon: true, evening: true },
    hours: HOURS,
    starts: [
      { time: "09:30", starts_at: "2026-10-03T04:00:00.000Z", open: true },
      { time: "10:00", starts_at: "2026-10-03T04:30:00.000Z", open: true },
    ],
  },
] as unknown as OpenDays;

describe("starts refused at booking", () => {
  it("are shut on the days read after, and the rest stay as answered", () => {
    const shut = withoutRefused(days, new Set(["2026-10-03T04:00:00.000Z"]));
    expect(shut?.[0]?.starts.map((start) => start.open)).toEqual([false, true]);
  });

  it("leave the days as answered while none was refused, or before the answer", () => {
    expect(withoutRefused(days, new Set())).toBe(days);
    expect(withoutRefused(null, new Set(["2026-10-03T04:00:00.000Z"]))).toBeNull();
  });
});
