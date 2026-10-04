// How many tasks the console's navigation says wait in each section (apps/ops/src/tasks/decided.ts): every one in
// Tasks, and each group's in the section that decides it, marked where any of them is overdue.

import { describe, expect, it } from "vitest";
import type { TaskGroup, Tasks } from "../../apps/ops/src/api.ts";
import { SECTIONS } from "../../apps/ops/src/route.ts";
import { DECIDED_IN, waitingIn } from "../../apps/ops/src/tasks/decided.ts";
import { TASK_DEPARTMENTS } from "../../src/policy/console-routes.ts";

const NOW = new Date("2027-09-22T05:00:00.000Z");

function group(name: TaskGroup["group"], count: number, dues: readonly string[]): TaskGroup {
  return {
    group: name,
    count,
    closable: false,
    tasks: dues.map((due, index) => ({
      id: `${name}-${String(index)}`,
      person: null,
      detail: null,
      since: "2027-09-15T06:00:00.000Z",
      due,
      owner: null,
    })),
  };
}

const board = (groups: TaskGroup[]): Tasks => ({
  overdue: 0,
  truncated: false,
  low_stock_places: 0,
  staff: [],
  groups,
});

describe("the counts beside the console's sections", () => {
  it("counts every task in Tasks, and each group's in the section that decides it", () => {
    const waiting = waitingIn(
      board([
        group("referral_review", 3, ["2027-09-24T06:00:00.000Z"]),
        group("erasure_request", 2, ["2027-09-25T06:00:00.000Z"]),
        group("replacement_order", 4, ["2027-09-26T06:00:00.000Z"]),
      ]),
      NOW,
    );

    expect(waiting.get("/tasks")).toEqual({ count: 9, overdue: false, of: "tasks" });
    expect(waiting.get("/referrals")).toEqual({ count: 3, overdue: false, of: "tasks" });
    expect(waiting.get("/deletion-requests")).toEqual({ count: 2, overdue: false, of: "tasks" });
    expect(waiting.has("/clients")).toBe(false);
  });

  it("adds the groups one section decides, and marks it where any task in them is overdue", () => {
    const waiting = waitingIn(
      board([
        group("untold_move", 1, ["2027-09-23T06:00:00.000Z"]),
        group("leave_conflict", 2, ["2027-09-20T06:00:00.000Z", "2027-09-24T06:00:00.000Z"]),
      ]),
      NOW,
    );

    expect(waiting.get("/dispatch")).toEqual({ count: 3, overdue: true, of: "tasks" });
    expect(waiting.get("/tasks")).toEqual({ count: 3, overdue: true, of: "tasks" });
  });

  // A disputed charge once had no count anywhere in the navigation (OIA-07).
  it("counts the disputed charges in No-shows, beside the cases waiting for a decision", () => {
    const waiting = waitingIn(
      board([
        group("no_show_decision", 1, ["2027-09-23T06:00:00.000Z"]),
        group("no_show_dispute", 2, ["2027-09-21T06:00:00.000Z", "2027-09-24T06:00:00.000Z"]),
      ]),
      NOW,
    );
    expect(waiting.get("/no-shows")).toEqual({ count: 3, overdue: true, of: "tasks" });
  });

  it("counts a due date of today as not yet overdue", () => {
    const waiting = waitingIn(board([group("grievance", 1, ["2027-09-22T12:00:00.000Z"])]), NOW);
    expect(waiting.get("/grievances")).toEqual({ count: 1, overdue: false, of: "tasks" });
  });

  it("badges Stock with the places low on something, never overdue and never in Tasks", () => {
    const waiting = waitingIn({ ...board([]), low_stock_places: 2 }, NOW);
    expect(waiting.get("/stock")).toEqual({ count: 2, overdue: false, of: "low_places" });
    expect(waiting.has("/tasks")).toBe(false);
  });

  it("counts nothing on an empty board", () => {
    expect(waitingIn(board([]), NOW).size).toBe(0);
  });

  it("counts a group only in a section of the department that decides it, which the board shows that group to", () => {
    for (const [group, decided] of Object.entries(DECIDED_IN)) {
      const section = SECTIONS.find((each) => each.path === decided.page);
      expect(section?.department, group).toBe(TASK_DEPARTMENTS[group as TaskGroup["group"]]);
    }
  });
});
