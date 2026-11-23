// A past week on Schedule (src/routes/tech/jobs.read.ts, src/domain/field/past-jobs.ts, ADR 0298): the technician's own
// jobs of seven days, each one's time, length, kind and how it closed, and nothing of its client. NOW is Monday 21
// September 2026, noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { get, insertJob, SAMEER, useFieldDay } from "./field-fixtures.ts";

useFieldDay();

const DONE = "22222222-2222-4222-8222-222222222231";
const SAMEERS = "22222222-2222-4222-8222-222222222232";
const DRAFT = "22222222-2222-4222-8222-222222222233";
const CANCELLED = "22222222-2222-4222-8222-222222222234";

interface Week {
  readonly from: string;
  readonly days: readonly { readonly date: string; readonly jobs: readonly Record<string, unknown>[] }[];
}

describe("a past week", () => {
  it("gives the technician's own jobs of its seven days, as they closed, with nothing of the client", async () => {
    // Wednesday 16 September: Imran's at 11 in India, done; Sameer's at 1 pm; a draft and a cancelled visit of Imran's.
    await insertJob(DONE, { start: "2026-09-16T05:30:00.000Z" });
    await insertJob(SAMEERS, { start: "2026-09-16T07:30:00.000Z", technician: SAMEER });
    await insertJob(DRAFT, { start: "2026-09-16T09:30:00.000Z" });
    await insertJob(CANCELLED, { start: "2026-09-17T05:30:00.000Z" });
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(DONE).run();
    await env.DB.prepare("UPDATE appointments SET technician_draft = 1 WHERE id = ?1").bind(DRAFT).run();
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(CANCELLED).run();

    const answer = await get("/api/tech/past-week?from=2026-09-14");
    const text = await answer.text();
    const week = JSON.parse(text) as Week;
    expect(answer.status).toBe(200);
    expect(week.days.map((day) => day.date)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(week.days.find((day) => day.date === "2026-09-16")?.jobs).toEqual([
      {
        id: DONE,
        starts_at: "2026-09-16T05:30:00.000Z",
        minutes: expect.any(Number) as number,
        type: "service",
        one_visit: false,
        status: "completed",
        progress: { started_at: null, outcome: null },
      },
    ]);
    expect(week.days.flatMap((day) => day.jobs)).toHaveLength(1);
    for (const kept of ["Rohit", "House 7", "Sector 65", "9810000001", "Gate 4417", "122018"]) {
      expect(text).not.toContain(kept);
    }
  });

  it("reads no week that does not end before today", async () => {
    // From the 14th the week ends on the 20th, yesterday; from the 15th it would take in today.
    expect((await get("/api/tech/past-week?from=2026-09-14")).status).toBe(200);
    expect((await get("/api/tech/past-week?from=2026-09-15")).status).toBe(400);
    expect((await get("/api/tech/past-week?from=2026-09-21")).status).toBe(400);
    expect((await get("/api/tech/past-week?from=14-09-2026")).status).toBe(400);
  });
});
