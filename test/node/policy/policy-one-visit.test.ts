// A consultation and fit in one visit (src/policy/one-visit.ts; ADR 0025, items 89 and 90).

import { describe, expect, it } from "vitest";
import { FIRST_FIT_WINDOWS, windowsFor } from "../../../src/config/scheduling.ts";
import { paymentBadge } from "../../../src/policy/job-visibility.ts";
import { cancelRefund, moveCost, noticeAt } from "../../../src/policy/moving-a-visit.ts";
import { chargedRefund, isDisputable } from "../../../src/policy/no-show.ts";
import {
  closedIfSentBy,
  ONE_VISIT_TERMS,
  ONE_VISIT_WINDOWS,
  paidAtTheVisit,
  paymentLinkClosesAt,
  PLANS,
} from "../../../src/policy/one-visit.ts";
import { stepsFor } from "../../../src/policy/in-job-steps.ts";

const WINDOW_STARTS = new Date("2026-09-24T03:30:00Z");
/** Two hours before the window: well inside its 24 hours. */
const LATE = new Date("2026-09-24T01:30:00Z");

describe("a consultation and fit in one visit", () => {
  it("sells the consultation alone or with the fit, which takes a first fit's steps and windows", () => {
    expect(PLANS).toEqual(["consultation", "one_visit"]);
    // The fit comes with the consultation's steps: the first fit's, its piece step, with the client's choice, first.
    expect([...stepsFor("first_fit", true)].sort()).toEqual([...stepsFor("first_fit")].sort());
    expect(stepsFor("first_fit", true).indexOf("piece")).toBeLessThan(stepsFor("first_fit", true).indexOf("checklist"));
    // However it closed, even as the consultation it becomes when the client declines.
    expect(stepsFor("consultation", true)).toEqual(stepsFor("first_fit", true));
    // Three hours, which start in the morning or the afternoon, as a first fit does.
    expect(ONE_VISIT_WINDOWS).toEqual(FIRST_FIT_WINDOWS);
    expect(windowsFor("first_fit")).toEqual([...ONE_VISIT_WINDOWS]);
  });

  it("takes payment at the visit once the client is fitted, and nothing if they decline", () => {
    expect(paidAtTheVisit("booked")).toBe(true);
    expect(paidAtTheVisit("fitted")).toBe(true);
    expect(paidAtTheVisit("declined")).toBe(false);
    expect(paidAtTheVisit(null)).toBe(false);
    // The technician's card and the dispatch board say so, and never an amount.
    expect(paymentBadge({ onCredit: false, free: false, oneVisit: true })).toBe("at_visit");
    expect(paymentBadge({ onCredit: false, free: false, oneVisit: false })).toBe("prepaid");
  });

  it("holds no payment, so a late move, a cancel or a no-show costs nothing", () => {
    expect(ONE_VISIT_TERMS).toMatchObject({ lateCharge: "nothing", noShowCharge: "nothing" });
    expect(noticeAt(WINDOW_STARTS, LATE, ONE_VISIT_TERMS.noticeHours)).toBe("late");
    // Inside the notice, a move is free and a cancel gives back all there is to give back, which is nothing.
    expect(moveCost("first_fit", "late", "client", ONE_VISIT_TERMS.lateCharge)).toBe("free");
    expect(cancelRefund("first_fit", "late", ONE_VISIT_TERMS.lateCharge)).toBe("all");
    // A charged no-show takes nothing either, so there is nothing for the client to dispute.
    expect(chargedRefund("first_fit", ONE_VISIT_TERMS.noShowCharge)).toBe("all");
    expect(isDisputable({ kept: 0, creditSpent: false })).toBe(false);
  });

  it("closes the payment link 14 days after it is made", () => {
    const made = new Date("2026-09-21T06:30:00.000Z");
    const closes = new Date("2026-10-05T06:30:00.000Z");
    expect(paymentLinkClosesAt(made)).toEqual(closes);
    // A link sent at `made` has closed by `closes`, and not a moment before.
    expect(closedIfSentBy(closes)).toEqual(made);
    expect(closedIfSentBy(new Date(closes.getTime() - 1)).getTime()).toBeLessThan(made.getTime());
  });
});
