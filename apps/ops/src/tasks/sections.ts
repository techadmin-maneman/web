// The Tasks board in sections, one per department, in the navigation's order: each department's groups, as the
// policy orders them, under its name and the count of everything waiting in it.

import { TASK_DEPARTMENTS } from "../../../../src/policy/console-routes.ts";
import type { TaskGroup } from "../api.ts";
import { daysUntil } from "../lib/due.ts";
import { DEPARTMENTS, type Department } from "../lib/grants.ts";

/** The rows a group shows until ops ask for the rest, so one long group cannot push the others out of sight. */
export const ROWS_FOLDED = 5;

export interface TaskSection {
  readonly department: Department;
  readonly count: number;
  readonly groups: readonly TaskGroup[];
}

/** The departments with something waiting, in the navigation's order. */
export function sectionsOf(groups: readonly TaskGroup[]): TaskSection[] {
  const sections: TaskSection[] = [];
  for (const department of DEPARTMENTS) {
    const theirs = groups.filter((each) => TASK_DEPARTMENTS[each.group] === department);
    if (theirs.length === 0) continue;
    const count = theirs.reduce((sum, each) => sum + each.count, 0);
    sections.push({ department, count, groups: theirs });
  }
  return sections;
}

interface TaskPlace {
  readonly group: TaskGroup["group"];
  readonly id: string;
  /** Its place in its group's list: a group shows the first ROWS_FOLDED until it is unfolded. */
  readonly index: number;
}

/** The first task on the board, reading down the sections, that is past its day; null if none listed is. */
export function firstOverdue(sections: readonly TaskSection[], now: Date): TaskPlace | null {
  for (const section of sections) {
    for (const group of section.groups) {
      const index = group.tasks.findIndex((task) => daysUntil(task.due, now) < 0);
      const task = group.tasks[index];
      if (task !== undefined) return { group: group.group, id: task.id, index };
    }
  }
  return null;
}
