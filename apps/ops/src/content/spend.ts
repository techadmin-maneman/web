// The Spend page's words (docs/decisions/0150-spend.md). No design draws it; every word here is ours.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const spend = {
  title: "Spend",
  month: "Month",
  city: "City",
  national: "National",
  channel: "Channel",
  channels: {
    partner: "Offline and partners",
    referral: "Referral",
    organic_social: "Social media",
    organic_search: "Search",
    direct: "Other",
  },
  campaign: "Campaign, if any",
  campaignNote: "Start its name with its city, or with national.",
  amount: "Amount before GST, Rs.",
  note: "Note",
  add: "Add",
  addOne: "Add spend",
  adding: "Adding…",
  none: "Nothing yet.",
  columns: { month: "Month", city: "City", channel: "Channel", amount: "Amount", note: "Note", by: "Added by" },
  remove: "Remove",
  /** "Remove: October 2026 · Gurgaon · Rs. 12,345" */
  removeLabel: (month: string, city: string, amount: string) => `Remove: ${month} · ${city} · ${amount}`,
  errors: {
    month: "Choose a month from the list.",
    city: "Choose a city from the list.",
    amount: "Type whole rupees, Rs. 1 or more.",
    invalid_request: "Check the amount and the month.",
    not_found: changed("Already taken off."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
