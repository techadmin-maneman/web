// The Tasks board in sections (apps/ops/src/tasks/sections.ts): each group under the department that decides it, in
// the navigation's order, and the first task past its day, which the head's overdue count goes to.

import { describe, expect, it } from "vitest";
import type { TaskGroup } from "../../../apps/ops/src/api.ts";
import { DEPARTMENTS } from "../../../apps/ops/src/lib/grants.ts";
import { firstOverdue, ROWS_FOLDED, sectionsOf } from "../../../apps/ops/src/tasks/sections.ts";
import { TASK_DEPARTMENTS } from "../../../src/policy/console-routes.ts";
import { TASK_GROUPS } from "../../../src/policy/tasks.ts";

const NOW = new Date("2027-09-22T05:00:00.000Z");
const LATER = "2027-09-25T06:00:00.000Z";
const PAST = "2027-09-20T06:00:00.000Z";

function group(name: TaskGroup["group"], count: number, dues: readonly string[] = [LATER]): TaskGroup {
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

describe("the Tasks board's sections", () => {
  it("gives every group a department the navigation draws", () => {
    for (const each of TASK_GROUPS) expect(DEPARTMENTS).toContain(TASK_DEPARTMENTS[each]);
  });

  // On staging, 29 rows of one group stood between "Call about a move" and "Job on a day off", and data-rights
  // deadlines were mixed in with sales follow-ups, in one list.
  it("puts each group under its department, in the navigation's order, each keeping the policy's order", () => {
    const sections = sectionsOf([
      group("untold_move", 1),
      group("leave_conflict", 2),
      group("replacement_order", 29),
      group("consultation_request", 3),
      group("referral_review", 1),
      group("no_show_decision", 2),
      group("erasure_request", 1),
      group("draft_invoice", 4),
    ]);

    expect(sections.map((each) => each.department)).toEqual(["operations", "customer_care", "finance", "growth"]);
    expect(sections.map((each) => each.groups.map((one) => one.group))).toEqual([
      ["untold_move", "leave_conflict", "replacement_order"],
      ["consultation_request", "erasure_request"],
      ["no_show_decision", "draft_invoice"],
      ["referral_review"],
    ]);
  });

  it("counts every task waiting in a department, not only those listed", () => {
    const [operations] = sectionsOf([group("replacement_order", 29), group("untold_move", 1)]);
    expect(operations?.count).toBe(30);
  });

  it("draws no section for a department with nothing waiting, and none on an empty board", () => {
    expect(sectionsOf([group("grievance", 1)]).map((each) => each.department)).toEqual(["customer_care"]);
    expect(sectionsOf([])).toEqual([]);
  });
});

describe("the first task past its day", () => {
  it("is the first one reading down the sections, whatever order the API listed the groups in", () => {
    const sections = sectionsOf([group("referral_review", 1, [PAST]), group("replacement_order", 2, [LATER, PAST])]);
    expect(firstOverdue(sections, NOW)).toEqual({ group: "replacement_order", id: "replacement_order-1", index: 1 });
  });

  it("says where it stands in its group, so a group folded above it can be unfolded", () => {
    const dues = [...Array.from({ length: ROWS_FOLDED }, () => LATER), PAST];
    const place = firstOverdue(sectionsOf([group("replacement_order", dues.length, dues)]), NOW);
    expect(place?.index).toBe(ROWS_FOLDED);
  });

  it("is none where every task listed is due today or later", () => {
    const today = "2027-09-22T12:00:00.000Z";
    expect(firstOverdue(sectionsOf([group("grievance", 2, [today, LATER])]), NOW)).toBeNull();
  });
});
