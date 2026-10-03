// Moving or cancelling a visit, each rule named by the prompt's own words (src/policy/moving-a-visit.ts).

import { describe, expect, it } from "vitest";
import {
  cancelRefund,
  changeChargedOnBooking,
  chargesFor,
  creditOnChange,
  freeUntil,
  LATE_CHANGE_CHARGES,
  moveCost,
  noticeAt,
  noticeCountsFrom,
  RULES,
} from "../../src/policy/moving-a-visit.ts";

/** A window starting at noon on Thursday 24 September, in India. */
const WINDOW = new Date("2026-09-24T06:30:00Z");
const hoursBefore = (hours: number) => new Date(WINDOW.getTime() - hours * 3_600_000);

describe("moving a visit", () => {
  it(RULES[0], () => {
    expect(freeUntil(WINDOW)).toEqual(hoursBefore(24));
    expect(noticeAt(WINDOW, hoursBefore(24.01))).toBe("free");
    for (const type of ["consultation", "first_fit", "service", "replacement"] as const) {
      expect(moveCost(type, "free", "client")).toBe("free");
      expect(cancelRefund(type, "free")).toBe("all");
    }
    expect(creditOnChange("free")).toBe("restored");
  });

  it(`${RULES[1]} ${RULES[2]}`, () => {
    expect(noticeAt(WINDOW, hoursBefore(24))).toBe("late");
    expect(moveCost("service", "late", "client")).toBe("charged");
    expect(cancelRefund("service", "late")).toBe("none");
  });

  it(`${RULES[1]} ${RULES[3]}`, () => {
    expect(creditOnChange(noticeAt(WINDOW, hoursBefore(24)))).toBe("lost");
    expect(creditOnChange(noticeAt(WINDOW, hoursBefore(24.01)))).toBe("restored");
  });

  it(RULES[4], () => {
    expect(moveCost("first_fit", "late", "client")).toBe("late_fee");
    expect(cancelRefund("first_fit", "late")).toBe("all_but_fee");
  });

  it(RULES[5], () => {
    expect(moveCost("replacement", "late", "client")).toBe("late_fee");
    expect(cancelRefund("replacement", "late")).toBe("all_but_fee");
  });

  it(RULES[6], () => {
    for (const type of ["consultation", "first_fit", "service", "replacement"] as const) {
      expect(moveCost(type, "late", "ops")).toBe("free");
    }
  });

  it(RULES[7], () => {
    const before = new Date("2026-09-24T06:30:00Z");
    const movedSooner = new Date("2026-09-22T03:30:00Z");
    expect(noticeCountsFrom(movedSooner, before)).toEqual(before);
    expect(noticeAt(noticeCountsFrom(movedSooner, before), new Date("2026-09-22T00:00:00Z"))).toBe("free");
    expect(noticeCountsFrom(movedSooner, null)).toEqual(movedSooner);
  });

  it("counts from the visit's own time where ops moved it later, so a move by ops never takes a free change away", () => {
    const before = new Date("2026-09-22T03:30:00Z");
    const movedLater = new Date("2026-09-24T06:30:00Z");
    expect(noticeCountsFrom(movedLater, before)).toEqual(movedLater);
  });

  it("leaves a free consultation free, whenever it moves or is cancelled", () => {
    expect(moveCost("consultation", "late", "client")).toBe("free");
    expect(cancelRefund("consultation", "late")).toBe("all");
  });
});

// Every figure of these terms is ops' to set (docs/decisions/0088-every-policy-in-the-console.md): the notice, and what
// each kind of visit costs inside it. The rules above are the committed terms, which stand until ops set others.
describe("the terms ops set", () => {
  it("counts the notice in the hours ops set", () => {
    expect(freeUntil(WINDOW, 48)).toEqual(hoursBefore(48));
    expect(noticeAt(WINDOW, hoursBefore(30), 48)).toBe("late");
    expect(noticeAt(WINDOW, hoursBefore(30))).toBe("free");
  });

  it("starts from the terms as the prompt states them", () => {
    expect(LATE_CHANGE_CHARGES).toEqual({
      consultation: "nothing",
      first_fit: "late_fee",
      replacement: "late_fee",
      service: "visit",
    });
  });

  it("charges inside the notice what ops set for the kind of visit", () => {
    expect(moveCost("service", "late", "client", "nothing")).toBe("free");
    expect(cancelRefund("service", "late", "nothing")).toBe("all");
    expect(creditOnChange("late", "nothing")).toBe("restored");
    expect(moveCost("first_fit", "late", "client", "visit")).toBe("charged");
    expect(cancelRefund("first_fit", "late", "visit")).toBe("none");
    expect(moveCost("consultation", "late", "client", "visit")).toBe("charged");
  });

  it("never charges for a move ops make, whatever they set", () => {
    expect(moveCost("service", "late", "ops", "visit")).toBe("free");
  });

  it("marks a visit booked inside its notice as charged to change, unless its kind costs nothing there", () => {
    const service = { noticeHours: 24, lateCharge: "visit" } as const;
    expect(changeChargedOnBooking(WINDOW, hoursBefore(23), service)).toBe(true);
    expect(changeChargedOnBooking(WINDOW, hoursBefore(24), service)).toBe(true);
    expect(changeChargedOnBooking(WINDOW, hoursBefore(25), service)).toBe(false);
    expect(changeChargedOnBooking(WINDOW, hoursBefore(30), { ...service, noticeHours: 48 })).toBe(true);
    expect(changeChargedOnBooking(WINDOW, hoursBefore(1), { noticeHours: 24, lateCharge: "late_fee" })).toBe(true);
    expect(changeChargedOnBooking(WINDOW, hoursBefore(1), { noticeHours: 24, lateCharge: "nothing" })).toBe(false);
  });

  it("offers a late fee only to a kind of visit that has one", () => {
    expect(chargesFor("first_fit")).toEqual(["nothing", "late_fee", "visit"]);
    expect(chargesFor("replacement")).toEqual(["nothing", "late_fee", "visit"]);
    expect(chargesFor("service")).toEqual(["nothing", "visit"]);
    expect(chargesFor("consultation")).toEqual(["nothing", "visit"]);
  });
});
