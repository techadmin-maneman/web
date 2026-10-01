// The client app's preview of an invite (board F4) is "exactly as the friend receives it", and what the friend
// receives is the landing's own preview, which the mm-site Worker writes into the invite's Open Graph tags. The
// two are in two content files, so this holds them to one another: a change of wording, of the area's name
// (ADR 0025, item 14), or of what ops give the friend (docs/decisions/0107-referral-rewards-in-the-console.md),
// changes both or fails here.

import { describe, expect, it } from "vitest";
import { empty, refer } from "../../apps/app/src/content.ts";
import { inviteDescription, inviteTitle } from "../../site/src/content/referral.ts";

const VALID = { state: "valid" as const, referrer_first_name: null, card: { state: "house" as const, version: 1 } };

describe("the app's preview of an invite", () => {
  it("is titled as the landing's preview, named and not", () => {
    expect(refer.preview.heading("Rohit")).toBe(inviteTitle("Rohit"));
    expect(refer.preview.heading(null)).toBe(inviteTitle(null));
  });

  it.each([3, 2, 1, 0])("says what a valid invite's preview says beneath it, the friend given %i", (friend) => {
    const reward = { referrer_visits: 3, friend_visits: friend, valid_days: 365 };
    expect(refer.preview.body(friend)).toBe(inviteDescription(VALID, reward));
  });
});

describe("the app's promise of what a referral earns", () => {
  const promise = (mine: number, theirs: number) => refer.promise({ referrer_visits: mine, friend_visits: theirs });

  it("says the board's words while each side gets 3", () => {
    expect(promise(3, 3)).toBe("When a friend you refer is fitted, you both get 3 service visits free.");
  });

  it("says each side's own count, and nothing ops did not give", () => {
    expect(promise(3, 2)).toBe(
      "When a friend you refer is fitted, you get 3 service visits free, and your friend gets 2.",
    );
    expect(promise(1, 0)).toBe("When a friend you refer is fitted, you get 1 service visit free.");
    expect(promise(0, 5)).toBe("When a friend you refer is fitted, they get 5 service visits free.");
    expect(promise(0, 0)).toBe("When a friend you refer is fitted, we tell you.");
  });

  it("is the empty Refer tab's second line, for a client who cannot refer yet", () => {
    expect(empty.refer.lines({ referrer_visits: 2, friend_visits: 4 })).toEqual([
      "Nobody you have referred has been fitted yet.",
      "When a friend you refer is fitted, you get 2 service visits free, and your friend gets 4.",
    ]);
  });

  it("is never a count typed into the app's words", () => {
    expect(JSON.stringify({ refer, empty })).not.toMatch(/\b\d+ (service )?visits?\b/);
  });
});
