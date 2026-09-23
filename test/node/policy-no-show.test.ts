// The no-show wait, each rule named by the prompt's own words (src/policy/no-show.ts).

import { describe, expect, it } from "vitest";
import {
  canCloseAsNoShow,
  NO_SHOW_DECISIONS,
  NO_SHOW_WAIT_MIN,
  RULES,
  waitEndsAt,
  type Evidence,
} from "../../src/policy/no-show.ts";
import { VISIT_TYPES } from "../../src/config/visit-types.ts";

/** A technician checks in at 10:00 on Monday 21 September, in India. */
const CHECKED_IN = new Date("2026-09-21T04:30:00Z");
const minutesLater = (minutes: number) => new Date(CHECKED_IN.getTime() + minutes * 60_000);

describe("no-show", () => {
  it(RULES[0], () => {
    expect(NO_SHOW_WAIT_MIN.service).toBe(15);
    expect(waitEndsAt(CHECKED_IN, "service")).toEqual(minutesLater(15));
  });

  it(RULES[1], () => {
    expect(canCloseAsNoShow(CHECKED_IN, "service", minutesLater(14))).toBe(false);
    expect(canCloseAsNoShow(CHECKED_IN, "service", minutesLater(15))).toBe(true);
  });

  it(RULES[4], () => {
    // The wait is per visit type, so a first fit can be given its own without
    // touching this rule. Every type waits 15 minutes until the owner rules.
    for (const type of VISIT_TYPES) expect(NO_SHOW_WAIT_MIN[type]).toBe(15);
  });

  it(RULES[3], () => {
    // The three facts, and nothing that decides anything: a case opens undecided.
    const evidence: Evidence = { checkedInAt: CHECKED_IN.toISOString(), distanceM: 42, messageDeliveredAt: null };
    expect(Object.keys(evidence)).toEqual(["checkedInAt", "distanceM", "messageDeliveredAt"]);
    expect(NO_SHOW_DECISIONS[0]).toBe("undecided");
    expect([...NO_SHOW_DECISIONS]).toEqual(["undecided", "charged", "waived"]);
  });
});
