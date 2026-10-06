// The client app's preview of an invite is "exactly as the friend receives it", and what the friend
// receives is the landing's own preview, which the mm-site Worker writes into the invite's Open Graph tags. The
// two are in two content files, so this holds them to one another: a change of wording, of the area's name
// (ADR 0025, item 14), or of what ops give the friend (docs/decisions/0107-referral-rewards-in-the-console.md),
// changes both or fails here.

import { describe, expect, it } from "vitest";
import { empty, refer } from "../../../../apps/app/src/content.ts";
import { inviteDescription, inviteTitle } from "../../../../site/src/content/referral.ts";

const VALID = { state: "valid" as const, referrer_first_name: null, card: { state: "house" as const, version: 1 } };

describe("the app's preview of an invite", () => {
  it("is titled as the landing's preview, named and not", () => {
    expect(refer.preview.heading("Rohit")).toBe(inviteTitle("Rohit"));
    expect(refer.preview.heading(null)).toBe(inviteTitle(null));
  });

  it.each([3, 2, 1, 0])("says what a valid invite's preview says beneath it, the friend given %i", (friend) => {
    const reward = { referrer_visits: 3, friend_visits: friend, valid_days: 365 };
    expect(refer.preview.body(reward)).toBe(inviteDescription(VALID, reward));
  });

  // A Home the phone kept from before mm-api answered the reward carries none (apps/app/src/refer/reward.ts).
  it("gives no count where the reward is not known, as the landing gives none", () => {
    expect(refer.preview.body(null)).toBe(inviteDescription(VALID, null));
    expect(refer.preview.body(null)).toBe("Home-fitted hair systems across Delhi NCR.");
  });
});

describe("the app's promise of what a referral earns", () => {
  const promise = (mine: number, theirs: number) => refer.promise({ referrer_visits: mine, friend_visits: theirs });

  it("says the board's promise in the reward's one name while each side gets 3", () => {
    expect(promise(3, 3)).toBe("When a friend you refer is fitted, you both get 3 free service visits.");
  });

  it("says each side's own count, and nothing ops did not give", () => {
    expect(promise(3, 2)).toBe(
      "When a friend you refer is fitted, you get 3 free service visits, and your friend gets 2.",
    );
    expect(promise(1, 0)).toBe("When a friend you refer is fitted, you get 1 free service visit.");
    expect(promise(0, 5)).toBe("When a friend you refer is fitted, they get 5 free service visits.");
    expect(promise(0, 0)).toBe("When a friend you refer is fitted, we tell you.");
  });

  it("gives no count where the reward is not known", () => {
    expect(refer.promise(null)).toBe("When a friend you refer is fitted, we tell you.");
  });

  it("is never a count typed into the app's words", () => {
    expect(JSON.stringify({ refer, empty })).not.toMatch(/\b\d+ (free )?(service )?visits?\b/);
  });
});

// Refer told a client not yet fitted that nobody they referred had
// been fitted, and a fitted client that no other discount applies, which is no longer so.
describe("Refer for a client not yet fitted", () => {
  const reward = { referrer_visits: 2, friend_visits: 4 };

  it("says when their invite opens, and what a referral will earn", () => {
    expect(empty.refer.lines(reward, null)).toEqual([
      "Your invite opens after your first fit.",
      "When a friend you refer is fitted, you get 2 free service visits, and your friend gets 4.",
    ]);
    expect(empty.refer.lines(null, null)).toEqual([
      "Your invite opens after your first fit.",
      "When a friend you refer is fitted, we tell you.",
    ]);
  });

  it("names the invite they came with first, and the visits it gives them at their fit", () => {
    expect(empty.refer.lines(reward, { referrer_first_name: "Rohit" })).toEqual([
      "Rohit’s invite: your 4 free service visits arrive when you’re fitted.",
      "Your own invite opens after your first fit.",
    ]);
    expect(empty.refer.lines({ referrer_visits: 3, friend_visits: 1 }, { referrer_first_name: null })).toEqual([
      "Your friend’s invite: your 1 free service visit arrives when you’re fitted.",
      "Your own invite opens after your first fit.",
    ]);
  });

  it("promises nothing from an invite where the friend is given nothing, or the reward is not known", () => {
    const invite = { referrer_first_name: "Rohit" };
    const nothingForTheFriend = { referrer_visits: 3, friend_visits: 0 };
    expect(empty.refer.lines(nothingForTheFriend, invite)[0]).toBe("Your invite opens after your first fit.");
    expect(empty.refer.lines(null, invite)[0]).toBe("Your invite opens after your first fit.");
  });

  it("never says a discount cannot be combined", () => {
    expect(JSON.stringify({ refer, empty })).not.toMatch(/discount/i);
  });
});
