// Where a task leads: the client's page on the tab the task is about, and the place it is decided. A task the
// dispatch board settles opens its visit's drawer there.

import { indiaDate } from "@maneman/web-kit/dates";
import type { Task, TaskGroup } from "../api.ts";
import { rowPath } from "../lib/target.ts";
import { clientPath, dispatchPath, type ClientTab } from "../route.ts";
import { DECIDED_IN } from "./decided.ts";

type Group = TaskGroup["group"];

/** The tab of the client's page each group is about. */
const CLIENT_TAB: Readonly<Record<Group, ClientTab>> = {
  untold_move: "visits",
  held_booking: "visits",
  leave_conflict: "visits",
  address_to_confirm: "visits",
  consultation_request: "visits",
  first_fit_to_book: "visits",
  replacement_order: "pieces",
  at_risk_client: "visits",
  partial_visit: "visits",
  referral_review: "visits",
  no_show_decision: "visits",
  no_show_dispute: "visits",
  number_change: "visits",
  erasure_request: "consents",
  grievance: "consents",
  draft_invoice: "payments",
  payment_owed: "payments",
  erasure_unfinished: "consents",
};

export const clientTabOf = (group: Group): ClientTab => CLIENT_TAB[group];

/** The client's page, on the tab the task is about. */
export const taskClientPath = (group: Group, personId: string): string => clientPath(personId, CLIENT_TAB[group]);

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
