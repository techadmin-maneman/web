// What Today works out from the day's list (apps/tech/src/lib/today.ts): the job it puts first, its title, and the
// line above the next job, where the technician is with it, else when to leave.

import { describe, expect, it } from "vitest";
import { today as copy } from "../../../apps/tech/src/content.ts";
import { closedAs, nextLine, nextOf, titleOf } from "../../../apps/tech/src/lib/today.ts";
import type { Queued } from "../../../apps/tech/src/store/outbox.ts";

const NOW = new Date("2026-11-10T03:30:00.000Z"); // 9 am in India
const leaving = (iso: string | null) => ({ leave_by: iso });

describe("the next job's line", () => {
  it("counts down to leaving, up to an hour and a half ahead", () => {
    expect(nextLine(leaving("2026-11-10T03:42:00.000Z"), null, NOW)).toBe(copy.next.leaveIn(12));
    // A part of a minute counts as a minute to wait, never as time to go.
    expect(nextLine(leaving("2026-11-10T03:30:30.000Z"), null, NOW)).toBe(copy.next.leaveIn(1));
    expect(nextLine(leaving("2026-11-10T05:00:00.000Z"), null, NOW)).toBe(copy.next.leaveIn(90));
  });

  it("says when to leave further off, to leave now once the time has come, and nothing of it without one", () => {
    expect(nextLine(leaving("2026-11-10T05:01:00.000Z"), null, NOW)).toBe(copy.next.leaveBy("10:31 am"));
    expect(nextLine(leaving("2026-11-10T03:30:00.000Z"), null, NOW)).toBe(copy.next.leaveNow);
    expect(nextLine(leaving("2026-11-10T03:00:00.000Z"), null, NOW)).toBe(copy.next.leaveNow);
    expect(nextLine(leaving(null), null, NOW)).toBe(copy.next.next);
  });

  it("says where the technician is with a job begun, whatever the time to leave", () => {
    expect(nextLine(leaving("2026-11-10T03:42:00.000Z"), "at_the_door", NOW)).toBe(copy.next.atTheDoor);
    expect(nextLine(leaving(null), "in_progress", NOW)).toBe(copy.next.inProgress);
  });
});

describe("the job Today puts first, and its title", () => {
  const jobs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const states = (a: "closed" | "in_progress" | "at_the_door" | null, b: typeof a, c: typeof a = null) =>
    new Map([
      ["a", a],
      ["b", b],
      ["c", c],
    ]);

  it("is the first job still to do, and the count is of those still to do", () => {
    expect(nextOf(jobs, states("closed", null))?.id).toBe("b");
    expect(titleOf(jobs, states("closed", null), true)).toBe(copy.jobs(2));
  });

  it("is one under way or at its door, ahead of an earlier one never closed", () => {
    expect(nextOf(jobs, states(null, "in_progress"))?.id).toBe("b");
    expect(nextOf(jobs, states(null, null, "at_the_door"))?.id).toBe("c");
  });

  it("says all is done once every job has closed, and that there are none on a day with none", () => {
    expect(nextOf(jobs, states("closed", "closed", "closed"))).toBeUndefined();
    expect(titleOf(jobs, states("closed", "closed", "closed"), true)).toBe(copy.allDone);
    expect(titleOf([], new Map(), true)).toBe(copy.noJobs);
    // Before the list loads, nothing is said to be done.
    expect(titleOf([], new Map(), false)).toBe(copy.jobs(0));
  });
});

describe("how a job done with closed, in a word", () => {
  const job = (outcome: string | null, status: "in_progress" | "completed" | "terminated" = "in_progress") => ({
    id: "a",
    status,
    progress: { started_at: "2026-11-10T04:00:00.000Z", outcome },
  });

  it("is the outcome the list has, else the one the phone heard land, else the one on its way", () => {
    expect(closedAs(job("partial"), [], undefined)).toBe(copy.closed.partial);
    // Landed after the list was read: the list still has none, and the phone heard it.
    expect(closedAs(job(null), [], { outcome: "done" })).toBe(copy.closed.done);
    const queued = [
      { job_id: "a", kind: "outcome", state: "waiting", body: { outcome: "no_show" } },
    ] as unknown as Queued[];
    expect(closedAs(job(null), queued, undefined)).toBe(copy.closed.no_show);
  });

  it("is the visit's status where no outcome is known", () => {
    expect(closedAs(job(null, "completed"), [], undefined)).toBe(copy.closed.done);
    expect(closedAs(job(null, "terminated"), [], undefined)).toBe(copy.closed.other);
  });
});
