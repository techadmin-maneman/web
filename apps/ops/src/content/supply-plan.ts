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
  forecast: {
    title: "Forecast",
    city: "City",
    none: "No forecast yet. It runs once each planning period.",
    empty: (city: string) => `Nothing expected in ${city}.`,
    /** "Expected use in each 7-day period from 21 Sep 2026, the high case beneath." */
    note: (days: number, from: string) =>
      `Expected use in each ${String(days)}-day period from ${from}, the high case beneath.`,
    item: "Item",
    /** "up to 7" */
    high: (figure: string) => `up to ${figure}`,
  },
  accuracy: {
    title: "Accuracy",
    none: "Measured once a forecast's first period has passed.",
    note: "Off by: each miss over what was used. Bias above nought: the forecast ran high.",
    periodColumns: ["Period from", "Expected", "Used", "Off by", "Bias", "Within high case"],
    itemColumns: ["Item", "Expected", "Used", "Off by", "Bias"],
    /** "18%", or a dash where nothing was used */
    percent: (value: number | null) => (value === null ? "—" : `${String(value)}%`),
    /** "+4%", "−7%" */
    bias: (value: number | null) => {
      if (value === null) return "—";
      return value < 0 ? `−${String(-value)}%` : `+${String(value)}%`;
    },
  },
  events: {
    title: "Events",
    note: "What will lift or drop demand. The next forecast reads them.",
    none: "No events ahead.",
    columns: ["Event", "City", "Days", "Change", ""],
    /** "+20%", "−10%" */
    change: (percent: number) => (percent < 0 ? `−${String(-percent)}%` : `+${String(percent)}%`),
    /** "1 Nov – 15 Nov 2026" */
    days: (from: string, to: string) => (from === to ? from : `${from} – ${to}`),
    remove: (name: string) => `Take off ${name}`,
    removeShort: "Take off",
    removed: "Event taken off.",
    add: "Add an event",
    name: "Event",
    city: "City",
    startsOn: "Starts",
    endsOn: "Ends",
    percent: "Change in demand, %",
    save: "Add event",
    added: "Event added.",
    errors: {
      ends_on: "It ends before it starts.",
      city: "We do not serve that city.",
      not_found: "That event is gone. Reload.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
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
