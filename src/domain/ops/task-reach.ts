// Where each task on the board is, so a caller sees only the tasks in their reach: each group's record, which the
// task's id names, and that record's city (./tasks.ts).

import { citiesOf, type PlacedId, type PlacedRecord } from "../clients/places.ts";
import { reachesCity, type PlacesReached } from "../../policy/access.ts";
import type { TaskGroup } from "../../policy/tasks.ts";
import type { Task } from "./tasks.ts";

/** The record each group's task is read from, which its id names and which says where the task is. */
const TASK_RECORDS: Readonly<Record<TaskGroup, PlacedRecord>> = {
  untold_move: "move",
  move_unanswered: "visit",
  visit_left_open: "visit",
  unassigned_visit: "visit",
  unanswered_chat: "conversation",
  city_matter: "city_matter",
  remedy_approval: "remedy",
  leave_conflict: "visit",
  address_to_confirm: "visit",
  consultation_request: "consultation_request",
  first_fit_to_book: "client",
  replacement_order: "piece",
  recall_call: "client",
  stock_at_risk: "visit",
  at_risk_client: "visit",
  partial_visit: "visit",
  referral_review: "referral",
  no_show_decision: "no_show",
  no_show_dispute: "dispute",
  number_change: "number_change",
  erasure_request: "deletion_request",
  grievance: "grievance",
  draft_invoice: "visit",
  payment_owed: "payment_link",
  payment_to_refund: "payment",
};

const recordOf = (task: Task): PlacedId => ({ kind: TASK_RECORDS[task.group], id: task.id });

/**
 * The tasks within reach: each group's where the caller's grants in the department that decides it reach its record's
 * city. A city is looked up only for a task whose group is not reached everywhere.
 */
export async function tasksWithin(
  db: D1Database,
  tasks: readonly Task[],
  reachOf: (group: TaskGroup) => PlacesReached,
): Promise<Task[]> {
  const toPlace = tasks.filter((task) => reachOf(task.group).kind !== "everywhere");
  if (toPlace.length === 0) return [...tasks];
  const cityOf = await citiesOf(db, toPlace.map(recordOf));
  return tasks.filter((task) => reachesCity(reachOf(task.group), cityOf(recordOf(task))));
}
