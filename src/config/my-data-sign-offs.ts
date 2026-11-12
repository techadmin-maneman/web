// The readable copy's part for a client's sign-offs of their fits (./my-data.ts;
// docs/decisions/0254-client-signs-off-the-fit.md): their own answer and words, never the technician's note for Care.

import { text, time, words, type Part } from "./my-data-fields.ts";

export const SIGN_OFFS_PART: Part = {
  title: "Your fits’ sign-offs",
  fields: {
    visit: time("Visit"),
    state: words("Sign-off"),
    checks: text("What you checked"),
    flag_text: text("What you said wasn’t right"),
    signed_at: time("Signed"),
    signed_on: words("Where"),
  },
};
