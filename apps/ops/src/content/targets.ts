// The Targets page's words (docs/decisions/0154-targets-and-reporting-access.md). No design draws it; every word here is
// ours.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const targets = {
  title: "Targets",
  setOne: "Set a target",
  month: "Month",
  city: "City",
  measure: "Measure",
  measures: {
    leads: "Leads",
    consultations: "Consultations done",
    new_clients: "New clients",
    active_clients: "Active clients",
    revenue: "Revenue, Rs. before GST",
    cac: "Acquisition cost, Rs.",
    utilisation: "Utilisation, %",
    on_time: "On time, %",
  },
  target: "Target",
  set: "Set",
  none: "No targets for this month.",
  columns: { city: "City", measure: "Measure", target: "Target", by: "Set by" },
  remove: "Remove",
  /** "Remove: Gurgaon · New clients" */
  removeLabel: (city: string, measure: string) => `Remove: ${city} · ${measure}`,
  errors: {
    month: "Choose a month from the list.",
    city: "Choose a city from the list.",
    target: "Too high for this measure: a percentage goes up to 100, a count or an amount to 1,00,00,000.",
    invalid_request: "Type a whole number.",
    not_found: changed("Already taken off."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
