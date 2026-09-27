// The no-show wait, each rule named by the prompt's own words (src/policy/no-show.ts).

import { describe, expect, it } from "vitest";
import {
  canCloseAsNoShow,
  NO_SHOW_DECISIONS,
  NO_SHOW_WAIT_MIN,
  noShowWaitEnds,
  RULES,
  SERVER_CLOCK_RULE,
  WAIVER_GIVES_BACK,
  waitEndsAt,
  type Evidence,
} from "../../src/policy/no-show.ts";
import { VISIT_TYPES } from "../../src/config/visit-types.ts";

/** A technician checks in at 10:00 on Monday 21 September, in India. */
const CHECKED_IN = new Date("2026-09-21T04:30:00Z");
const minutesLater = (minutes: number) => new Date(CHECKED_IN.getTime() + minutes * 60_000);
/** A check-in the server received the moment the phone made it. */
const ONLINE = { at: CHECKED_IN, receivedAt: CHECKED_IN };

describe("no-show", () => {
  it(RULES[0], () => {
    expect(NO_SHOW_WAIT_MIN.service).toBe(15);
    expect(waitEndsAt(CHECKED_IN, "service")).toEqual(minutesLater(15));
  });

  it(RULES[1], () => {
    expect(canCloseAsNoShow(ONLINE, "service", minutesLater(14))).toBe(false);
    expect(canCloseAsNoShow(ONLINE, "service", minutesLater(15))).toBe(true);
  });

  it(SERVER_CLOCK_RULE, () => {
    // The phone says 10:00 and the server heard at 10:20: a back-dated check-in, or a basement.
    const heardLate = { at: CHECKED_IN, receivedAt: minutesLater(20) };
    expect(canCloseAsNoShow(heardLate, "service", minutesLater(34))).toBe(false);
    expect(canCloseAsNoShow(heardLate, "service", minutesLater(35))).toBe(true);
    expect(noShowWaitEnds(heardLate, "service")).toEqual(minutesLater(35));
  });

  it(RULES[4], () => {
    // The wait is per visit type, so a first fit can be given its own without
    // touching this rule. The owner ruled 15 minutes for every type on
    // 24 September 2026, a first fit included.
    for (const type of VISIT_TYPES) expect(NO_SHOW_WAIT_MIN[type]).toBe(15);
  });

  it(RULES[3], () => {
    // The three facts, and nothing that decides anything: a case opens undecided.
    const evidence: Evidence = { checkedInAt: CHECKED_IN.toISOString(), distanceM: 42, messageDeliveredAt: null };
    expect(Object.keys(evidence)).toEqual(["checkedInAt", "distanceM", "messageDeliveredAt"]);
    expect(NO_SHOW_DECISIONS[0]).toBe("undecided");
    expect([...NO_SHOW_DECISIONS]).toEqual(["undecided", "charged", "waived"]);
  });

  // BIZ-28: the rule says what a charge keeps and nothing of what a waiver gives back, which the owner ruled
  // on 27 September 2026: "Refund and credit back" (docs/owner-answers-2026-09-27.md).
  it("gives back the payment and the credit on a waiver, as the owner ruled", () => {
    expect(WAIVER_GIVES_BACK).toBe(true);
  });
});
