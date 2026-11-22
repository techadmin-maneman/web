// Which department decides each group of tasks: its people see the group on Tasks, and Act may take a task of it
// (./console-routes.ts reads it for each task's need). Kept apart from the route list, which is long enough.

import type { Department } from "./access.ts";
import type { TaskGroup } from "./tasks.ts";

/** The department that decides each group of tasks: its people see the group on Tasks, and Act may take a task of it. */
export const TASK_DEPARTMENTS: Readonly<Record<TaskGroup, Department>> = {
  untold_move: "operations",
  move_unanswered: "operations",
  visit_not_begun: "operations",
  visit_left_open: "operations",
  unassigned_visit: "operations",
  leave_request: "operations",
  recall_call: "customer_care",
  unanswered_chat: "customer_care",
  city_matter: "operations",
  remedy_approval: "customer_care",
  leave_conflict: "operations",
  address_to_confirm: "customer_care",
  consultation_request: "customer_care",
  first_fit_to_book: "customer_care",
  heard_from_missing: "customer_care",
  replacement_order: "operations",
  made_to_order_ask: "operations",
  custom_order_to_send: "operations",
  custom_piece_to_fit: "operations",
  stock_at_risk: "operations",
  at_risk_client: "customer_care",
  partial_visit: "operations",
  consumables_short: "operations",
  fit_unsigned: "customer_care",
  message_undelivered: "customer_care",
  erasure_follow_up: "customer_care",
  low_rating: "customer_care",
  fit_guarantee_claim: "customer_care",
  kit_request: "operations",
  reschedule_request: "operations",
  referral_review: "growth",
  no_show_decision: "finance",
  no_show_dispute: "finance",
  number_change: "customer_care",
  erasure_request: "customer_care",
  grievance: "customer_care",
  draft_invoice: "finance",
  payment_owed: "finance",
  upi_due: "finance",
  payment_to_refund: "finance",
};
