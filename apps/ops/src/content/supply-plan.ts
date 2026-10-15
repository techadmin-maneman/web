// Operations · Supply plan (docs/decisions/0180-supply-plan.md). No design draws it; every word here is ours. Only the
// Supply plan page reads it, loaded when it opens.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const supplyPlan = {
  title: "Supply plan",
  transfers: "Transfers",
  orders: "Orders",
  none: "Nothing to approve.",
  transferColumns: ["Item", "From", "To", "For", "Quantity", ""],
  orderColumns: ["Item", "Supplier", "For", "Quantity", ""],
  /** "Needs 13 (4 buffer) · 3 on hand": the need, rounded up, with the buffer it holds. */
  why: (line: { need: number; safety: number; usable: number }) =>
    `Needs ${String(Math.ceil(line.need))} (${String(Math.ceil(line.safety))} buffer) · ${String(line.usable)} on hand`,
  everyCity: "Every city",
  quantity: (name: string) => `Quantity of ${name}`,
  approve: "Approve",
  reject: "Reject",
  why_label: "Reason",
  confirmReject: "Reject it",
  keep: "Keep line",
  draft: "Draft again",
  drafted: "Drafted again from the latest forecast.",
  approvedSaid: "Approved.",
  rejectedSaid: "Rejected.",
  states: { approved: "Approved", rejected: "Rejected" },
  /** "PO-0007" */
  order: (number: number) => `PO-${String(number).padStart(4, "0")}`,
  forecast: {
    title: "Forecast",
    city: "City",
    none: "No forecast yet.",
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
    none: "Measured once a forecast’s first period has passed.",
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
    none: "No events ahead.",
    columns: ["Event", "City", "Days", "Change", ""],
    /** "+20%", "−10%" */
    change: (percent: number) => (percent < 0 ? `−${String(-percent)}%` : `+${String(percent)}%`),
    /** "1 Nov to 15 Nov 2026" */
    days: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
    remove: (name: string) => `Remove ${name}`,
    removeShort: "Remove",
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
      city: "We don’t serve that city.",
      not_found: changed("That event is gone."),
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  errors: {
    order_state: changed("That line is decided already, or no forecast has run."),
    not_found: changed("That line is gone."),
    invalid_request: changed("That couldn’t be made: stock or the supplier moved since."),
    supplier_id: "That supplier is retired. Reject the line, or draft again.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
