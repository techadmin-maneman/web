// What the referral landing says an invite earns: built from what ops set in the console, each side apart, and
// never a count typed into a sentence (site/src/content/referral.ts; docs/decisions/0107-referral-rewards-in-the-console.md).

import { describe, expect, it } from "vitest";
import { inviteDescription, referral } from "../../site/src/content/referral.ts";
import * as site from "../../site/src/content/site.ts";
import { publishProblems } from "../../site/src/lib/publish-gate.ts";
import type { ReferralReward } from "../../site/src/lib/api.ts";

const reward = (referrer: number, friend: number): ReferralReward => ({
  referrer_visits: referrer,
  friend_visits: friend,
  valid_days: 365,
});

const VALID = { state: "valid" as const, referrer_first_name: null, card: { state: "house" as const, version: 1 } };
const UNKNOWN = { ...VALID, state: "unknown" as const };

/** Every sentence of the landing that gives a count, as the reward and the referrer's name make it. */
function sentences(given: ReferralReward | null, name: string | null = "Rohit"): string[] {
  return [
    given === null ? null : referral.arrival.offer(given),
    referral.arrival.unknown.body(given),
    referral.consultation.told(name, given),
    referral.booked.credits(given),
    referral.expired.body(given),
    inviteDescription(VALID, given),
  ].filter((sentence): sentence is string => sentence !== null);
}

// PS-24: /book says who is told of the fit before it sends the invite this browser remembers.
describe("what /book says of the invite this browser remembers", () => {
  it("says who is told of the fit, with the friend's visits as ops set them", () => {
    expect(referral.remembered.consultation(reward(3, 3))).toBe(
      "You have an invite. Whoever invited you is told when you are fitted. That is when the 3 visits land.",
    );
    expect(referral.remembered.consultation(reward(3, 0))).toBe(
      "You have an invite. Whoever invited you is told when you are fitted.",
    );
    expect(referral.remembered.waitlist).toMatch(/ Whoever invited you is told when you are fitted\.$/);
  });

  it("is said on the landing's waitlist too, by the referrer's name where it has one", () => {
    expect(referral.waitlist.holds).toMatch(/ \{name\} is told when you are fitted\.$/);
    expect(referral.waitlist.holdsUnnamed).toMatch(/ Whoever invited you is told when you are fitted\.$/);
  });
});

describe("what the landing says an invite earns", () => {
  it("says the design's words while each side gets 3", () => {
    expect(sentences(reward(3, 3))).toEqual([
      "Get fitted and you both get 3 service visits free.",
      "The consultation is still free; the 3 service visits do not apply.",
      "Rohit is told when you are fitted. That is when the 3 visits land.",
      "The 3 service visits land when you are fitted.",
      "More than 12 months old. The consultation is still free; the 3 visits do not apply.",
      "Home-fitted hair systems across Delhi NCR. 3 service visits free when you're fitted.",
    ]);
    expect(referral.consultation.told(null, reward(3, 3))).toBe(
      "Whoever invited you is told when you are fitted. That is when the 3 visits land.",
    );
  });

  it("gives each side its own count, and never one ops did not set", () => {
    const said = sentences(reward(7, 5));
    expect(said[0]).toBe("Get fitted and you get 5 service visits free. Your friend gets 7.");
    expect(said.slice(1)).toEqual([
      "The consultation is still free; the 5 service visits do not apply.",
      "Rohit is told when you are fitted. That is when the 5 visits land.",
      "The 5 service visits land when you are fitted.",
      "More than 12 months old. The consultation is still free; the 5 visits do not apply.",
      "Home-fitted hair systems across Delhi NCR. 5 service visits free when you're fitted.",
    ]);
    expect(said.join(" ")).not.toMatch(/\b3\b/);
  });

  it("writes one visit as one", () => {
    expect(sentences(reward(1, 1))).toEqual([
      "Get fitted and you both get 1 service visit free.",
      "The consultation is still free; the 1 service visit does not apply.",
      "Rohit is told when you are fitted. That is when the 1 visit lands.",
      "The 1 service visit lands when you are fitted.",
      "More than 12 months old. The consultation is still free; the 1 visit does not apply.",
      "Home-fitted hair systems across Delhi NCR. 1 service visit free when you're fitted.",
    ]);
  });

  it("promises the friend nothing where ops give the friend nothing, and still says the referrer is told", () => {
    expect(sentences(reward(3, 0))).toEqual([
      "Get fitted and your friend gets 3 service visits free.",
      "The consultation is still free.",
      "Rohit is told when you are fitted.",
      "More than 12 months old. The consultation is still free.",
      "Home-fitted hair systems across Delhi NCR.",
    ]);
  });

  it("promises only the friend's visits where ops give the referrer nothing", () => {
    expect(referral.arrival.offer(reward(0, 2))).toBe("Get fitted and you get 2 service visits free.");
  });

  it("makes no offer where nobody gets anything", () => {
    expect(referral.arrival.offer(reward(0, 0))).toBeNull();
  });

  it("gives no count while the reward is not known", () => {
    expect(sentences(null)).toEqual([
      "The consultation is still free.",
      "Rohit is told when you are fitted.",
      "More than 12 months old. The consultation is still free.",
      "Home-fitted hair systems across Delhi NCR.",
    ]);
  });

  it("promises the visits in the preview only for a valid invite", () => {
    expect(inviteDescription(UNKNOWN, reward(3, 3))).toBe("Home-fitted hair systems across Delhi NCR.");
    expect(inviteDescription(null, reward(3, 3))).toBe("Home-fitted hair systems across Delhi NCR.");
  });
});

describe("the publish gate, on what a referral earns", () => {
  const approved = Object.fromEntries(
    Object.entries(site.notices).map(([name, notice]) => [name, { ...notice, approved: true }]),
  );

  it("stops a count of visits typed into the landing", () => {
    const landing = {
      ...referral,
      booked: { ...referral.booked, credits: "The 3 service visits land when you are fitted." },
    };
    expect(publishProblems(undefined, approved, [site, landing])).toEqual([
      'a count of visits is typed by hand, "The 3 service visits land when you are fitted.": what a referral earns ' +
        "is set in the console (docs/decisions/0107-referral-rewards-in-the-console.md)",
    ]);
  });

  it.each([
    "Get fitted and you both get three service visits free.",
    "Rohit is told when you are fitted. That is when the three visits land.",
    "The consultation is still free; the three service visits do not apply.",
  ])("stops a reward spelled out in words: %s", (typed) => {
    const landing = { ...referral, booked: { ...referral.booked, credits: typed } };
    expect(publishProblems(undefined, approved, [site, landing])).toHaveLength(1);
  });

  // The site's own words for a year of visits, and for the fit, are no reward.
  it("lets through visits counted in words that are no reward", () => {
    const words = {
      example: "A standard base in the first year: {firstFit} plus twelve service visits at {service}.",
      hero: "Transformation and confidence, delivered in one visit.",
      cell: "One visit a month",
    };
    expect(publishProblems(undefined, approved, [site, referral, words])).toEqual([]);
  });

  it("finds none in the site or the landing as they are", () => {
    expect(publishProblems(undefined, approved, [site, referral])).toEqual([]);
  });
});
