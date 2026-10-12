// Operations · Supply plan (docs/decisions/0180-supply-plan.md). No design draws it; every word here is ours. Only the
// Supply plan page reads it, loaded when it opens.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const supplyPlan = {
  title: "Supply plan",
  transfers: "Transfers",
  orders: "Orders",
  none: "Nothing proposed. The plan drafts again once the next forecast runs.",
  transferColumns: ["Item", "From", "To", "For", "Quantity", ""],
  orderColumns: ["Item", "Supplier", "For", "Quantity", ""],
  /** "Needs 12.5 with 4 safety · can use 3" */
  why: (line: { need: number; safety: number; usable: number }) =>
    `Needs ${String(line.need)} with ${String(line.safety)} safety · can use ${String(line.usable)}`,
  everyCity: "Every city",
  quantity: (name: string) => `Quantity of ${name}`,
  approve: "Approve",
  reject: "Reject",
  why_label: "Why it is rejected",
  confirmReject: "Reject it",
  keep: "Keep it",
  draft: "Draft again",
  drafted: "Drafted again from the latest forecast.",
  approvedSaid: "Approved.",
  rejectedSaid: "Rejected.",
  states: { approved: "Approved", rejected: "Rejected" } as Readonly<Record<string, string>>,
  /** "PO-0007" */
  order: (number: number) => `PO-${String(number).padStart(4, "0")}`,
  errors: {
    order_state: "That line is decided already, or no forecast has run. Reload.",
    not_found: "That line is gone. Reload.",
    invalid_request: "That could not be made: stock or the supplier moved since. Reload.",
    supplier_id: "That supplier is retired. Reject the line, or draft again.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
};
