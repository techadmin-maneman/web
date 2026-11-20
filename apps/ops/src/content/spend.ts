// The Spend page's words (docs/decisions/0150-spend.md, 0288). No design draws it; every word here is ours.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const spend = {
  title: "Spend",
  day: "Day",
  city: "City",
  national: "National",
  channel: "Channel",
  campaign: "Campaign, if any",
  campaignNote: "Start its name with its city, or with national.",
  amount: "Amount before GST, Rs.",
  note: "Note",
  add: "Add",
  addOne: "Add spend",
  adding: "Adding…",
  none: "No spend recorded yet.",
  columns: {
    day: "Day",
    city: "City",
    channel: "Channel",
    amount: "Amount",
    from: "From",
    note: "Note",
    by: "Added by",
  },
  from: { manual: "Typed", csv: "Ad account CSV", link: "Society activation", api: "Ad account" },
  find: "Find a campaign or note",
  remove: "Remove",
  /** "Remove: 20 November 2026 · Gurgaon · Rs. 12,345" */
  removeLabel: (day: string, city: string, amount: string) => `Remove: ${day} · ${city} · ${amount}`,
  importOne: "Import CSV",
  import: {
    platform: "Ad account",
    platforms: { google: "Google Ads", meta: "Meta Ads" },
    file: "Report, broken down by day",
    fileHint: "Google Ads: Day, Campaign, Cost. Meta: Day, Campaign name, Amount spent (INR).",
    /** "31 rows · Rs. 48,210" */
    read: (rows: number, amount: string) => `${String(rows)} ${rows === 1 ? "row" : "rows"} · ${amount}`,
    submit: "Import",
    /** What Import waits for, said beneath it. */
    missing: "Choose the report’s file.",
    importing: "Importing…",
    /** "31 rows imported." */
    done: (rows: number) => `${String(rows)} ${rows === 1 ? "row" : "rows"} imported.`,
    header: "No Day, Campaign and Cost columns found.",
    empty: "No spend in this file.",
    /** "Line 12: write the day as 2026-11-20." */
    day: (line: number) => `Line ${String(line)}: write the day as 2026-11-20.`,
  },
  errors: {
    day: "Choose a day in the last thirteen months.",
    city: "Choose a city from the list.",
    amount: "Type whole rupees, Rs. 1 or more.",
    rows: "A day in the file is outside the last thirteen months.",
    invalid_request: "Check the amount and the day.",
    already_imported: "This file is imported already.",
    not_found: changed("Already taken off."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
