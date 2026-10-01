// A consultation and fit in one visit (src/policy/one-visit.ts), each rule named by the owner's words of 1 October
// 2026, or by what the build took for the owner to confirm (ADR 0025, items 89 and 90).

import { describe, expect, it } from "vitest";
import { FIRST_FIT_WINDOWS, windowsFor } from "../../src/config/scheduling.ts";
import { paymentBadge } from "../../src/policy/job-visibility.ts";
import { cancelRefund, moveCost, noticeAt } from "../../src/policy/moving-a-visit.ts";
import { chargedRefund, isDisputable } from "../../src/policy/no-show.ts";
import { ONE_VISIT_TERMS, ONE_VISIT_WINDOWS, paidAtTheVisit, PLANS, RULES } from "../../src/policy/one-visit.ts";
import { stepsFor } from "../../src/policy/in-job-steps.ts";

const WINDOW_STARTS = new Date("2026-09-24T03:30:00Z");
/** Two hours before the window: well inside its 24 hours. */
const LATE = new Date("2026-09-24T01:30:00Z");

describe("a consultation and fit in one visit", () => {
  it(RULES[0], () => {
    expect(PLANS).toEqual(["consultation", "one_visit"]);
    // The fit comes with the consultation's steps: the first fit's, its piece step included.
    expect(stepsFor("first_fit", true)).toContain("piece");
    // However it closed, even as the consultation it becomes when the client declines.
    expect(stepsFor("consultation", true)).toEqual(stepsFor("first_fit"));
    // Three hours, which start in the morning or the afternoon, as a first fit does.
    expect(ONE_VISIT_WINDOWS).toEqual(FIRST_FIT_WINDOWS);
    expect(windowsFor("first_fit")).toEqual([...ONE_VISIT_WINDOWS]);
  });

  it(RULES[1], () => {
    expect(paidAtTheVisit("booked")).toBe(true);
    expect(paidAtTheVisit("fitted")).toBe(true);
    expect(paidAtTheVisit("declined")).toBe(false);
    expect(paidAtTheVisit(null)).toBe(false);
    // The technician's card and the dispatch board say so, and never an amount.
    expect(paymentBadge({ onCredit: false, free: false, oneVisit: true })).toBe("at_visit");
    expect(paymentBadge({ onCredit: false, free: false, oneVisit: false })).toBe("prepaid");
  });

  it(RULES[2], () => {
    expect(ONE_VISIT_TERMS).toMatchObject({ lateCharge: "nothing", noShowCharge: "nothing" });
    expect(noticeAt(WINDOW_STARTS, LATE, ONE_VISIT_TERMS.noticeHours)).toBe("late");
    // Inside the notice, a move is free and a cancel gives back all there is to give back, which is nothing.
    expect(moveCost("first_fit", "late", "client", ONE_VISIT_TERMS.lateCharge)).toBe("free");
    expect(cancelRefund("first_fit", "late", ONE_VISIT_TERMS.lateCharge)).toBe("all");
    // A charged no-show takes nothing either, so there is nothing for the client to dispute.
    expect(chargedRefund("first_fit", ONE_VISIT_TERMS.noShowCharge)).toBe("all");
    expect(isDisputable({ kept: 0, creditSpent: false })).toBe(false);
  });
});
