// The Spend page's words (docs/decisions/0150-spend.md). No design draws it; every word here is ours.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const spend = {
  title: "Offline spend",
  intro:
    "What we spend to win clients that no ad account reports, before GST. Google and Meta come from their own accounts.",
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
  amount: "Amount, Rs.",
  note: "Note",
  add: "Add",
  adding: "Adding",
  none: "Nothing yet.",
  columns: { month: "Month", city: "City", channel: "Channel", amount: "Amount", note: "Note", by: "Added by" },
  remove: "Take off",
  /** "Take off: October 2026 · Gurgaon · Rs. 25,000" */
  removeLabel: (month: string, city: string, amount: string) => `Take off: ${month} · ${city} · ${amount}`,
  errors: {
    month: "Pick a month from the list.",
    city: "Pick a city from the list.",
    amount: "Type whole rupees, Rs. 1 or more.",
    invalid_request: "Check the amount and the month.",
    not_found: "Already taken off. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  },
};
