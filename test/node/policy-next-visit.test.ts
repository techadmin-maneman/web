// The next visit, offered in the app and booked by the client
// (src/policy/next-visit.ts; ADR 0025, item 69; docs/archive/owner-answers-2026-09-27.md). The days are India's calendar days.

import { describe, expect, it } from "vitest";
import { FIRST_FIT_WINDOWS, windowsFor } from "../../src/config/scheduling.ts";
import {
  atRiskFrom,
  atRiskIfDoneBy,
  firstFitOpens,
  firstFitToBookFrom,
  firstFitToBookIfConsultedBy,
  lastBookableDay,
  NEXT_VISIT_DAY_BOUNDS,
  NEXT_VISIT_DAY_KEYS,
  NEXT_VISIT_DAYS,
  nextVisitAfter,
  nextVisitType,
  offeredDay,
  offeredWindow,
  pastTheHorizon,
  remindedIfDoneBetween,
  serviceDue,
} from "../../src/policy/next-visit.ts";
import { TASK_GROUPS, TASK_SLA_HOURS } from "../../src/policy/tasks.ts";

/** Monday 21 September 2026, and the Tuesday after it. */
const TODAY = "2026-09-21";
const TOMORROW = "2026-09-22";

describe("the next visit", () => {
  it("makes the next service due 30 days on, with a reminder 7 days before and an At-risk task 7 days after", () => {
    // Due 30 days after the last first fit, service or replacement.
    expect(NEXT_VISIT_DAYS.service_cadence).toBe(30);
    expect(serviceDue("2026-09-10", NEXT_VISIT_DAYS)).toBe("2026-10-10");
    // The reminder 7 days before it is due, and the At-risk client task 7 days after.
    expect(NEXT_VISIT_DAYS.reminder_before_due).toBe(7);
    expect(NEXT_VISIT_DAYS.at_risk_after_due).toBe(7);
    expect(atRiskFrom("2026-09-10", NEXT_VISIT_DAYS)).toBe("2026-10-17");
    expect(TASK_GROUPS).toContain("at_risk_client");
  });

  // "If the client's piece falls due before, offer the replacement instead."
  it("offers a replacement when the hair system falls due by the service's day, and a service otherwise", () => {
    expect(nextVisitType("2026-10-10", "2026-10-05")).toBe("replacement");
    expect(nextVisitType("2026-10-10", "2026-10-10")).toBe("replacement");
    expect(nextVisitType("2026-10-10", "2026-10-11")).toBe("service");
    expect(nextVisitType("2026-10-10", null)).toBe("service");
  });

  it("offers the next visit on its due day, or tomorrow once that has passed", () => {
    // Offered on the day it falls due, or tomorrow once that has passed: the client books it, on the day they choose.
    expect(offeredDay("2026-10-10", TOMORROW)).toBe("2026-10-10");
    expect(offeredDay("2026-09-01", TOMORROW)).toBe(TOMORROW);
  });

  it("offers whichever falls due first, the service or the hair system, and an overdue one for tomorrow", () => {
    // A service past its due day keeps that day, and is offered for tomorrow.
    expect(nextVisitAfter("2026-08-01", null, TOMORROW, NEXT_VISIT_DAYS)).toEqual({
      type: "service",
      dueOn: "2026-08-31",
      offeredOn: TOMORROW,
    });
    // A piece falling due before the service is offered on its own day, not the service's.
    expect(nextVisitAfter("2026-09-10", "2026-10-05", TOMORROW, NEXT_VISIT_DAYS)).toEqual({
      type: "replacement",
      dueOn: "2026-10-05",
      offeredOn: "2026-10-05",
    });
    // A piece already overdue is offered for tomorrow, under its own due day.
    expect(nextVisitAfter("2026-09-10", "2026-09-01", TOMORROW, NEXT_VISIT_DAYS)).toEqual({
      type: "replacement",
      dueOn: "2026-09-01",
      offeredOn: TOMORROW,
    });
    // Both overdue, the service first: the overdue piece is still the visit offered, for tomorrow.
    expect(nextVisitAfter("2026-08-01", "2026-09-10", TOMORROW, NEXT_VISIT_DAYS)).toEqual({
      type: "replacement",
      dueOn: "2026-09-10",
      offeredOn: TOMORROW,
    });
    // A piece falling due after the service is offered stays a service.
    expect(nextVisitAfter("2026-09-10", "2026-10-11", TOMORROW, NEXT_VISIT_DAYS)).toMatchObject({ type: "service" });
  });

  it("opens the fit the day after the consultation, unless ops set a lead time", () => {
    expect(NEXT_VISIT_DAYS.first_fit_lead).toBe(0);
    // No minimum: tomorrow, the first day anything is booked on, even after a consultation done today.
    expect(firstFitOpens(TODAY, TOMORROW, NEXT_VISIT_DAYS)).toBe(TOMORROW);
    // A lead time ops set counts from the consultation's day.
    expect(firstFitOpens("2026-09-18", TOMORROW, { ...NEXT_VISIT_DAYS, first_fit_lead: 10 })).toBe("2026-09-28");
    expect(firstFitOpens("2026-09-01", TOMORROW, { ...NEXT_VISIT_DAYS, first_fit_lead: 10 })).toBe(TOMORROW);
  });

  it("puts a fit still to book on the Tasks board 7 days after its consultation", () => {
    expect(TASK_GROUPS).toContain("first_fit_to_book");
    expect(firstFitToBookFrom("2026-09-10", NEXT_VISIT_DAYS)).toBe("2026-09-17");
    expect(firstFitToBookIfConsultedBy(TODAY, NEXT_VISIT_DAYS)).toBe("2026-09-14");
  });

  it("lets a client book 45 days ahead, so the next service is bookable the day the last visit closes", () => {
    expect(NEXT_VISIT_DAYS.horizon).toBe(45);
    const last = lastBookableDay(TOMORROW, NEXT_VISIT_DAYS);
    expect(last).toBe("2026-11-05");
    // A service due 30 days after a visit done today is inside it.
    expect(serviceDue(TODAY, NEXT_VISIT_DAYS) <= last).toBe(true);
  });

  it("reminds of a service due from today to a week from now, and never of one done today", () => {
    expect(remindedIfDoneBetween(TODAY, NEXT_VISIT_DAYS)).toEqual({ from: "2026-08-22", to: "2026-08-29" });
    // A reminder as long as the cadence would fall the day the visit was done: it goes the day after instead.
    expect(remindedIfDoneBetween(TODAY, { ...NEXT_VISIT_DAYS, service_cadence: 14, reminder_before_due: 14 })).toEqual({
      from: "2026-09-07",
      to: "2026-09-20",
    });
  });

  it("offers the next visit in the window of the one it follows, where a visit of its kind can start in it", () => {
    expect(offeredWindow("first_fit", "afternoon")).toBe("afternoon");
    expect(offeredWindow("service", "evening")).toBe("evening");
    // A first fit's two slots and a replacement's slot and a half do not fit in the evening.
    expect(offeredWindow("first_fit", "evening")).toBeNull();
    expect(offeredWindow("replacement", "evening")).toBeNull();
  });

  it("makes a client at risk the day that is a week past their due day", () => {
    // Done 15 August, due 14 September, at risk from 21 September.
    expect(atRiskIfDoneBy(TODAY, NEXT_VISIT_DAYS)).toBe("2026-08-15");
    expect(atRiskFrom("2026-08-15", NEXT_VISIT_DAYS)).toBe(TODAY);
  });

  it("gives both of ops' new groups the allowance every group starts with", () => {
    expect(TASK_SLA_HOURS.at_risk_client).toBe(48);
    expect(TASK_SLA_HOURS.first_fit_to_book).toBe(48);
  });
});

describe("the figures ops set", () => {
  it("are one of each key, each committed figure inside its own bounds", () => {
    expect(Object.keys(NEXT_VISIT_DAYS)).toEqual([...NEXT_VISIT_DAY_KEYS]);
    expect(Object.keys(NEXT_VISIT_DAY_BOUNDS)).toEqual([...NEXT_VISIT_DAY_KEYS]);
    for (const key of NEXT_VISIT_DAY_KEYS) {
      const { min, max } = NEXT_VISIT_DAY_BOUNDS[key];
      expect(NEXT_VISIT_DAYS[key], key).toBeGreaterThanOrEqual(min);
      expect(NEXT_VISIT_DAYS[key], key).toBeLessThanOrEqual(max);
    }
  });

  it("never let the horizon be shorter than the fortnight the date strip shows", () => {
    expect(NEXT_VISIT_DAY_BOUNDS.horizon.min).toBe(14);
  });

  // The app offers a visit on the day it falls due, so the horizon must reach as far as any of them.
  it("name the figures that reach past the horizon, and none for the committed ones", () => {
    expect(pastTheHorizon(NEXT_VISIT_DAYS)).toEqual([]);
    expect(pastTheHorizon({ ...NEXT_VISIT_DAYS, service_cadence: 60, horizon: 45 })).toEqual(["service_cadence"]);
    expect(pastTheHorizon({ ...NEXT_VISIT_DAYS, service_cadence: 45, horizon: 45 })).toEqual([]);
    expect(pastTheHorizon({ ...NEXT_VISIT_DAYS, first_fit_lead: 30, service_cadence: 14, horizon: 20 })).toEqual([
      "first_fit_lead",
    ]);
  });

  it("let the lead time be nought, and no other figure", () => {
    expect(NEXT_VISIT_DAY_BOUNDS.first_fit_lead.min).toBe(0);
    for (const key of NEXT_VISIT_DAY_KEYS.filter((each) => each !== "first_fit_lead")) {
      expect(NEXT_VISIT_DAY_BOUNDS[key].min, key).toBeGreaterThan(0);
    }
  });
});

// The site's form no longer asks for a first fit to follow the consultation: the owner's ruling of 1 October 2026
// put the consultation and fit in one visit in its place (src/policy/one-visit.ts). What a first fit can start in stands.
describe("the first fit's windows", () => {
  it("start in the morning or the afternoon, since its two slots do not fit in the evening's", () => {
    expect([...FIRST_FIT_WINDOWS]).toEqual(windowsFor("first_fit"));
    expect(windowsFor("first_fit")).not.toContain("evening");
    expect(windowsFor("replacement")).not.toContain("evening");
    expect(windowsFor("service")).toEqual(["morning", "afternoon", "evening"]);
  });
});
