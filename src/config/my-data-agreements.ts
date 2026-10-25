// The readable copy's parts for what a client agreed to: each consent, and each time they agreed to the terms
// (./my-data.ts).

import { text, time, words, yesNo, type Part } from "./my-data-fields.ts";

export const CONSENTS_PART: Part = {
  title: "What you agreed to",
  fields: {
    purpose: { label: "For", as: "purpose" },
    granted: yesNo("Agreed"),
    notice_version: { label: "What you were shown", as: "notice" },
    source: words("Where"),
    created_at: time("When"),
  },
};

export const TERMS_PART: Part = {
  title: "The terms you agreed to",
  fields: {
    terms_version: text("Terms and Conditions version"),
    privacy_version: text("Privacy Policy version"),
    source: words("Where"),
    created_at: time("When"),
  },
};
