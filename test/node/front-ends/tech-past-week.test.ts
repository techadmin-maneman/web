// Schedule's weeks before this one (apps/tech/src/schedule/past-week.ts): seven days at a time back from today, each
// past job by its kind, how it closed and its length, opening nothing.

import { describe, expect, it } from "vitest";
import type { PastJob } from "../../../apps/tech/src/api.ts";
import { pastBlocksOf, weekStartOf } from "../../../apps/tech/src/schedule/past-week.ts";

const TODAY = "2026-11-23";

const job = (over: Partial<PastJob>): PastJob => ({
  id: "22222222-2222-4222-8222-222222222231",
  starts_at: "2026-11-18T05:30:00.000Z",
  minutes: 90,
  type: "service",
  one_visit: false,
  status: "completed",
  progress: { started_at: null, outcome: null },
  ...over,
});

describe("Schedule's past weeks", () => {
  it("counts weeks back from today by sevens, so this week is today's own and yesterday the week before's last", () => {
    expect(weekStartOf(null, TODAY)).toBe(TODAY);
    expect(weekStartOf("2026-11-26", TODAY)).toBe(TODAY);
    expect(weekStartOf("2026-11-22", TODAY)).toBe("2026-11-16");
    expect(weekStartOf("2026-11-16", TODAY)).toBe("2026-11-16");
    expect(weekStartOf("2026-11-15", TODAY)).toBe("2026-11-09");
  });

  it("draws each past job by its kind, how it closed and its length, behind the technician, as a link to nothing", () => {
    const [done, open] = pastBlocksOf([
      job({}),
      job({ id: "22222222-2222-4222-8222-222222222232", status: "scheduled", starts_at: "2026-11-18T09:30:00.000Z" }),
    ]);
    expect(done).toEqual({
      key: "22222222-2222-4222-8222-222222222231",
      start: 11 * 60,
      minutes: 90,
      look: "done",
      title: "Service visit",
      meta: "Done · 1 h 30 min",
    });
    expect(open).toMatchObject({ start: 15 * 60, look: "done", meta: "Not closed · 1 h 30 min" });
    expect(done).not.toHaveProperty("to");
  });
});
