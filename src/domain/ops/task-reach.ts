// Where each task on the board is, so a caller reads only the tasks in their reach: each group's record, which the
// task's id names, and that record's city. The board keeps to it in the statement that reads each queue (./tasks.ts),
// so one city's queues never crowd another's out of a look.

import { idWithinReach, type PlacedRecord } from "../clients/places.ts";
import type { TaskGroup } from "../../policy/tasks.ts";

/** The record each group's task is read from, which its id names and which says where the task is. */
const TASK_RECORDS: Readonly<Record<TaskGroup, PlacedRecord>> = {
  untold_move: "move",
  move_unanswered: "visit",
  reschedule_request: "reschedule_request",
  visit_not_begun: "visit",
  visit_left_open: "visit",
  unassigned_visit: "visit",
  unanswered_chat: "conversation",
  message_undelivered: "message",
  erasure_follow_up: "client",
  city_matter: "city_matter",
  remedy_approval: "remedy",
  leave_conflict: "visit",
  leave_request: "leave_request",
  address_to_confirm: "visit",
  consultation_request: "consultation_request",
  first_fit_to_book: "client",
  heard_from_missing: "client",
  replacement_order: "piece",
  made_to_order_ask: "made_to_order_ask",
  custom_order_to_send: "custom_order",
  custom_piece_to_fit: "custom_order",
  recall_call: "client",
  stock_at_risk: "visit",
  at_risk_client: "visit",
  partial_visit: "visit",
  consumables_short: "visit",
  fit_unsigned: "visit",
  low_rating: "visit",
  fit_guarantee_claim: "client_report",
  kit_request: "kit_request",
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
  staff_task_operations: "staff_task",
  staff_task_customer_care: "staff_task",
  staff_task_finance: "staff_task",
  staff_task_growth: "staff_task",
  staff_task_admin: "staff_task",
};

/**
 * An SQL condition that keeps a task of the group, its id `id`, where the reach bound to `param` (reachBinding) gets
 * to its record's city.
 */
export const taskWithinReach = (group: TaskGroup, id: string, param: string): string =>
  idWithinReach(TASK_RECORDS[group], id, param);
