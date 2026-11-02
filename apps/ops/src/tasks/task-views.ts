// What Tasks is narrowed to (./TasksScreen.tsx): every task, the person's own, those nobody owns, or those overdue,
// each with how many it holds; one kind; or a client found by name or number. A task names no city, so the board
// narrows by these alone.

import type { Task, TaskGroup } from "../api.ts";
import { daysUntil } from "../lib/due.ts";

type Group = TaskGroup["group"];

export const TASK_VIEWS = ["all", "mine", "nobody", "overdue"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export interface TaskFilter {
  readonly view: TaskView;
  readonly kind: string;
  readonly search: string;
}

export const NO_FILTER: TaskFilter = { view: "all", kind: "", search: "" };

/** A task as the table lists it: its group, and whose it is now, as taken or given here since the board was read. */
export interface Row {
  readonly group: Group;
  readonly task: Task;
  readonly owner: string | null;
}

/** Whether the row is one of the view's: the person's own, nobody's, or past its due day. */
function inView(view: TaskView, row: Row, me: string | null, now: Date): boolean {
  if (view === "mine") return me !== null && row.owner === me;
  if (view === "nobody") return row.owner === null;
  if (view === "overdue") return daysUntil(row.task.due, now) < 0;
  return true;
}

/** The rows of the kind asked, and of the client found by part of a name or a number. */
function ofKindAndClient(rows: readonly Row[], filter: TaskFilter): Row[] {
  const search = filter.search.trim().toLowerCase();
  return rows.filter(
    ({ group, task }) =>
      (filter.kind === "" || group === filter.kind) &&
      (search === "" || `${task.person?.name ?? ""} ${task.person?.mobile ?? ""}`.toLowerCase().includes(search)),
  );
}

/** The rows the filter asks for, and how many each view would hold beside them. */
export function narrowed(
  rows: readonly Row[],
  filter: TaskFilter,
  me: string | null,
  now: Date,
): { rows: Row[]; counts: Readonly<Record<TaskView, number>> } {
  const found = ofKindAndClient(rows, filter);
  const count = (view: TaskView) => found.filter((row) => inView(view, row, me, now)).length;
  return {
    rows: found.filter((row) => inView(filter.view, row, me, now)),
    counts: { all: found.length, mine: count("mine"), nobody: count("nobody"), overdue: count("overdue") },
  };
}
