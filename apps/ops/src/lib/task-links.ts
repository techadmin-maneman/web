// Where a task leads: the client's page on the tab the task is about, and the place it is decided. A task the
// dispatch board settles opens its visit's drawer there.

import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import type { Task, TaskGroup } from "../api.ts";
import { tasks } from "../content.ts";
import { rowPath } from "./target.ts";
import { clientPath, dispatchPath, type ClientTab } from "../route.ts";
import { DECIDED_IN } from "../tasks/decided.ts";

type Group = TaskGroup["group"];

/** The groups about something other than the client's visits, and the tab of their page each is about. */
const CLIENT_TAB: Partial<Record<Group, ClientTab>> = {
  replacement_order: "pieces",
  draft_invoice: "payments",
  payment_owed: "payments",
  payment_to_refund: "payments",
  erasure_request: "consents",
  grievance: "consents",
};

/** The tab of the client's page a task of the group is about: Visits, unless the group is about something else. */
export const taskTabOf = (group: Group): ClientTab => CLIENT_TAB[group] ?? "visits";

/** The client's page, on the tab the task is about. */
export const taskClientPath = (group: Group, personId: string): string => clientPath(personId, taskTabOf(group));

/** The board opened on the week of the task's visit, with its drawer open; this week's board for a task with none. */
function onTheBoard(task: Task): string {
  if (task.visit === undefined) return dispatchPath({});
  return dispatchPath({ from: indiaDate(task.visit.starts_at), visit: task.visit.id });
}

/** The section and row a task is decided on; null for a group done from its row or on the client's page. */
export function decidedAt(group: Group, task: Task): string | null {
  const where = DECIDED_IN[group];
  if (where === undefined) return null;
  if (where.page === "/dispatch") return onTheBoard(task);
  return where.row === null ? where.page : rowPath(where.page, where.row, task.id);
}

/**
 * A task's first line: the client's name, or, with no client to name, an erased client's visit, a disputed charge, or
 * the number a chat came from.
 */
export function subjectOf(group: Group, task: Task): string {
  if (task.person !== null) return task.person.name;
  if (group === "no_show_dispute") return tasks.disputeErased;
  if (task.facts.group === "unanswered_chat") return task.facts.mobile;
  return tasks.visit(shortDate(indiaDate(task.since)));
}
