// The readable copy's part for a client's sign-offs of their fits (./my-data.ts;
// docs/decisions/0254-client-signs-off-the-fit.md): their own answer and words, never the technician's note for Care.

import { named, text, time, yesNo, type Part } from "./my-data-fields.ts";

export const SIGN_OFFS_PART: Part = {
  title: "Your fits’ sign-offs",
  fields: {
    visit: time("Visit"),
    state: named("Sign-off", {
      asked: "Asked",
      signed: "Signed off",
      flagged: "Said something wasn’t right",
      declined: "Not signed",
    }),
    hairline: yesNo("The hairline sits where we agreed"),
    blend: yesNo("The colour and the blend look right"),
    secure: yesNo("It feels secure and comfortable"),
    flag_text: text("What you last said wasn’t right"),
    signed_at: time("Signed"),
    signed_on: named("Where", { client_app: "In your app", technician_phone: "On the technician’s phone" }),
  },
};
