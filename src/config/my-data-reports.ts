// The readable copy's part for the issues a client reported from the app (./my-data.ts;
// docs/decisions/0258-the-issue-log.md): their own words, and when each was settled.

import { named, text, time, type Part } from "./my-data-fields.ts";

export const REPORTS_PART: Part = {
  title: "Issues you reported",
  fields: {
    number: text("Number"),
    category: named("About", {
      fit_guarantee: "The fit (guarantee)",
      edges_lifting: "Edges lifting",
      itching: "Itching or irritation",
      colour: "Colour or shine",
      shedding: "Shedding",
      fit_comfort: "Fit or comfort",
      visit: "A visit or technician",
      payment: "Payment or refund",
      other: "Something else",
    }),
    text: text("What you told us"),
    created_at: time("Reported"),
    closed_at: time("Settled by Care"),
    sorted_at: time("You marked it sorted"),
    reopened_at: time("You reopened it"),
  },
};
