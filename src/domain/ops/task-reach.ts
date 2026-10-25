// Where each task on the board is, so a caller reads only the tasks in their reach: each group's record, which the
// task's id names, and that record's city. The board keeps to it in the statement that reads each queue (./tasks.ts),
// so one city's queues never crowd another's out of a look.

import { idWithinReach, type PlacedRecord } from "../clients/places.ts";
import type { TaskGroup } from "../../policy/tasks.ts";

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
  leave_request: "leave_request",
  address_to_confirm: "visit",
  consultation_request: "consultation_request",
  first_fit_to_book: "client",
  replacement_order: "piece",
  recall_call: "client",
  stock_at_risk: "visit",
  at_risk_client: "visit",
  partial_visit: "visit",
  consumables_short: "visit",
  referral_review: "referral",
  no_show_decision: "no_show",
  no_show_dispute: "dispute",
  number_change: "number_change",
  erasure_request: "deletion_request",
  grievance: "grievance",
  draft_invoice: "visit",
  payment_owed: "payment_link",
  upi_due: "visit",
  payment_to_refund: "payment",
};

/**
 * An SQL condition that keeps a task of the group, its id `id`, where the reach bound to `param` (reachBinding) gets
 * to its record's city.
 */
export const taskWithinReach = (group: TaskGroup, id: string, param: string): string =>
  idWithinReach(TASK_RECORDS[group], id, param);
