// The client app's preview of an invite (board F4) is "exactly as the friend receives it", and what the friend
// receives is the landing's own preview, which the mm-site Worker writes into the invite's Open Graph tags. The
// two are in two content files, so this holds them to one another: a change of wording, or of the area's name
// (ADR 0025, item 14), changes both or fails here.

import { describe, expect, it } from "vitest";
import { refer } from "../../apps/app/src/content.ts";
import { inviteDescription, inviteTitle } from "../../site/src/content/referral.ts";

describe("the app's preview of an invite", () => {
  it("is titled as the landing's preview, named and not", () => {
    expect(refer.preview.heading("Rohit")).toBe(inviteTitle("Rohit"));
    expect(refer.preview.heading(null)).toBe(inviteTitle(null));
  });

  it("says what a valid invite's preview says beneath it", () => {
    expect(refer.preview.body).toBe(
      inviteDescription({ state: "valid", referrer_first_name: null, card: { state: "house", version: 1 } }),
    );
  });
});
