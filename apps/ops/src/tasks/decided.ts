// Where each group of tasks is decided, and so how many wait in each section of the navigation.

import type { TaskGroup, Tasks } from "../api.ts";
import { daysUntil } from "../lib/due.ts";
import type { SectionPath } from "../route.ts";

type Group = TaskGroup["group"];

/**
 * Where each group's task is decided: the section, and the kind of row the
 * task's id names there. A group missing here is done from the row, or outside
 * the console (in Books), and reaches only the client's page.
 */
export const DECIDED_IN: Partial<Record<Group, { readonly page: SectionPath; readonly row: string | null }>> = {
  // The dispatch board draws a week, not a list: the link opens the task's visit there, in its own drawer.
  untold_move: { page: "/dispatch", row: null },
  leave_conflict: { page: "/dispatch", row: null },
  referral_review: { page: "/referrals", row: "held" },
  no_show_decision: { page: "/no-shows", row: "case" },
  no_show_dispute: { page: "/no-shows", row: "dispute" },
  number_change: { page: "/number-changes", row: "change" },
  erasure_request: { page: "/deletion-requests", row: "request" },
  grievance: { page: "/grievances", row: "grievance" },
};

export interface Waiting {
  readonly count: number;
  readonly overdue: boolean;
  /** What is counted: tasks, or for Stock the places low on something. */
  readonly of: "tasks" | "low_places";
}

/** A group lists its longest waits first, so an overdue task in it is always among those listed. */
const hasOverdue = (group: TaskGroup, now: Date): boolean => group.tasks.some((task) => daysUntil(task.due, now) < 0);

/** How many tasks wait in each section: every one in Tasks, and each group's in the section that decides it. */
export function waitingIn(board: Tasks, now: Date): ReadonlyMap<SectionPath, Waiting> {
  const waiting = new Map<SectionPath, Waiting>();
  const add = (path: SectionPath, group: TaskGroup) => {
    const was = waiting.get(path) ?? { count: 0, overdue: false, of: "tasks" };
    waiting.set(path, { count: was.count + group.count, overdue: was.overdue || hasOverdue(group, now), of: "tasks" });
  };
  for (const group of board.groups) {
    add("/tasks", group);
    const decided = DECIDED_IN[group.group];
    if (decided !== undefined) add(decided.page, group);
  }
  // Stock's badge: the places low on something, which wait on a delivery or a transfer and are never overdue.
  if (board.low_stock_places > 0)
    waiting.set("/stock", { count: board.low_stock_places, overdue: false, of: "low_places" });
  return waiting;
}
