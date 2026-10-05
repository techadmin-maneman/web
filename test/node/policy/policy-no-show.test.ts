// The no-show: the wait, what a charge costs, and its dispute (src/policy/no-show.ts).

import { describe, expect, it } from "vitest";
import {
  canCloseAsNoShow,
  chargedCredit,
  chargedRefund,
  DISPUTE_RULINGS,
  isDisputable,
  NO_SHOW_CHARGES,
  NO_SHOW_DECISIONS,
  NO_SHOW_WAIT_MIN,
  noShowWaitEnds,
  WAIVER_GIVES_BACK,
  waitEndsAt,
  waitStartsAt,
  type Evidence,
} from "../../../src/policy/no-show.ts";
import { VISIT_TYPES } from "../../../src/config/visit-types.ts";
import { LATE_CHANGE_CHARGES } from "../../../src/policy/moving-a-visit.ts";

/** A technician checks in at 10:00 on Monday 21 September, in India, for a visit booked for 10:00. */
const CHECKED_IN = new Date("2026-09-21T04:30:00Z");
const VISIT_START = CHECKED_IN;
const minutesLater = (minutes: number) => new Date(CHECKED_IN.getTime() + minutes * 60_000);
/** A check-in the server received the moment the phone made it. */
const ONLINE = { at: CHECKED_IN, receivedAt: CHECKED_IN };

describe("no-show", () => {
  it("starts the wait at check-in, and runs it 15 minutes", () => {
    expect(NO_SHOW_WAIT_MIN.service).toBe(15);
    expect(waitEndsAt(CHECKED_IN, "service")).toEqual(minutesLater(15));
  });

  it("closes no job as a no-show before the wait ends", () => {
    expect(canCloseAsNoShow(ONLINE, VISIT_START, "service", minutesLater(14))).toBe(false);
    expect(canCloseAsNoShow(ONLINE, VISIT_START, "service", minutesLater(15))).toBe(true);
  });

  it("runs the wait on the server's clock too, whatever time the phone gave the check-in", () => {
    // The phone says 10:00 and the server heard at 10:20: a back-dated check-in, or a basement.
    const heardLate = { at: CHECKED_IN, receivedAt: minutesLater(20) };
    expect(canCloseAsNoShow(heardLate, VISIT_START, "service", minutesLater(34))).toBe(false);
    expect(canCloseAsNoShow(heardLate, VISIT_START, "service", minutesLater(35))).toBe(true);
    expect(noShowWaitEnds(heardLate, VISIT_START, "service")).toEqual(minutesLater(35));
  });

  it("waits from the booked start for a technician who checked in early", () => {
    // Checked in at 09:10 for the 10:00 visit: the client's fifteen minutes run from 10:00.
    const early = { at: minutesLater(-50), receivedAt: minutesLater(-50) };
    expect(waitStartsAt(early.at, VISIT_START)).toEqual(VISIT_START);
    expect(noShowWaitEnds(early, VISIT_START, "service")).toEqual(minutesLater(15));
    expect(canCloseAsNoShow(early, VISIT_START, "service", minutesLater(-35))).toBe(false);
    expect(canCloseAsNoShow(early, VISIT_START, "service", minutesLater(14))).toBe(false);
    expect(canCloseAsNoShow(early, VISIT_START, "service", minutesLater(15))).toBe(true);

    // Twenty minutes late: the wait runs from the check-in, as the prompt says.
    const late = { at: minutesLater(20), receivedAt: minutesLater(20) };
    expect(waitStartsAt(late.at, VISIT_START)).toEqual(minutesLater(20));
    expect(noShowWaitEnds(late, VISIT_START, "service")).toEqual(minutesLater(35));
  });

  it("closes no visit as a no-show before its booked start, however early the check-in", () => {
    // The audit's gate: a 4 pm visit checked in at 11:06 showed "The wait is over" at 11:11.
    const fourPm = new Date("2026-09-21T10:30:00Z");
    const elevenOhSix = new Date("2026-09-21T05:36:00Z");
    const checkIn = { at: elevenOhSix, receivedAt: elevenOhSix };
    const fiveMinutes = { ...NO_SHOW_WAIT_MIN, service: 5 };
    expect(canCloseAsNoShow(checkIn, fourPm, "service", new Date("2026-09-21T05:41:00Z"), fiveMinutes)).toBe(false);
    expect(noShowWaitEnds(checkIn, fourPm, "service", fiveMinutes)).toEqual(new Date("2026-09-21T10:35:00Z"));
  });

  it("keeps a wait for each kind of visit, 15 minutes for every one, so one can differ", () => {
    for (const type of VISIT_TYPES) expect(NO_SHOW_WAIT_MIN[type]).toBe(15);
  });

  it("opens a case undecided, on the check-in, the distance and the message delivered", () => {
    // The three facts, and nothing that decides anything: a case opens undecided.
    const evidence: Evidence = { checkedInAt: CHECKED_IN.toISOString(), distanceM: 42, messageDeliveredAt: null };
    expect(Object.keys(evidence)).toEqual(["checkedInAt", "distanceM", "messageDeliveredAt"]);
    expect(NO_SHOW_DECISIONS[0]).toBe("undecided");
    expect([...NO_SHOW_DECISIONS]).toEqual(["undecided", "charged", "waived"]);
  });

  it("gives back the payment and the credit on a waiver", () => {
    expect(WAIVER_GIVES_BACK).toEqual({ payment: "refunded", credit: "returned" });
  });

  it("charges what a late cancellation of the same visit costs, to begin with", () => {
    expect(NO_SHOW_CHARGES).toEqual(LATE_CHANGE_CHARGES);
    expect(NO_SHOW_CHARGES).not.toBe(LATE_CHANGE_CHARGES);
    // "first fit ₹4,000, replacement ₹3,000, a paid service visit kept, a credit lost"
    expect(chargedRefund("first_fit", NO_SHOW_CHARGES.first_fit)).toBe("all_but_fee");
    expect(chargedRefund("replacement", NO_SHOW_CHARGES.replacement)).toBe("all_but_fee");
    expect(chargedRefund("service", NO_SHOW_CHARGES.service)).toBe("none");
    expect(chargedCredit(NO_SHOW_CHARGES.service)).toBe("lost");
    expect(chargedRefund("consultation", NO_SHOW_CHARGES.consultation)).toBe("all");
  });

  it("charges what ops set a no-show to cost, apart from a late change", () => {
    expect(chargedRefund("service", "nothing")).toBe("all");
    expect(chargedCredit("nothing")).toBe("restored");
    expect(chargedRefund("first_fit", "visit")).toBe("none");
  });

  it("lets the client dispute a charge, and ops refund or uphold it, with a reason", () => {
    expect([...DISPUTE_RULINGS]).toEqual(["refunded", "upheld"]);
    expect(isDisputable({ kept: 400000, creditSpent: false })).toBe(true);
    expect(isDisputable({ kept: 0, creditSpent: true })).toBe(true);
    // A charge that took nothing has nothing to give back.
    expect(isDisputable({ kept: 0, creditSpent: false })).toBe(false);
  });
});
