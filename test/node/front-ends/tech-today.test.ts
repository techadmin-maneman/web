// What Today works out from the day's list (apps/tech/src/lib/today.ts): the job it puts first, its title, and the
// line above the next job, where the technician is with it, else when to leave.

import { describe, expect, it } from "vitest";
import { today as copy } from "../../../apps/tech/src/content.ts";
import { nextLine, nextOf, titleOf } from "../../../apps/tech/src/lib/today.ts";

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
