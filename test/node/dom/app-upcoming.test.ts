// What the client app's Visits lists under Upcoming (apps/app/src/visits/upcoming.ts), and what a visit being booked
// is called. D-04: while FSM held a booking, Home said "We are booking your visit." and Visits said "Nothing booked
// yet."; Home also called a consultation and fit in one visit a first fit.

import { describe, expect, it } from "vitest";
import type { Me, VisitSummary } from "../../../apps/app/src/api.ts";
import { bookingName, oneVisitOf, visitTitle } from "../../../apps/app/src/lib/visit.ts";
import { upcomingEntries } from "../../../apps/app/src/visits/upcoming.ts";

type BeingBooked = NonNullable<Me["being_booked"]>;

const visit = (id: string, date: string): VisitSummary => ({ id, date }) as VisitSummary;

const PRICE = { amount: 3_000_000, from: false, code: null };
const BOOKING: BeingBooked = {
  type: "first_fit",
  date: "2026-10-08",
  window: "morning",
  paid: false,
  one_visit: PRICE,
  told: false,
};
const CONSULTATION = {
  date: "2026-10-06",
  window: "morning",
  window_label: "before noon",
  place: "Gurgaon",
  requested: false,
  one_visit: null,
} as const;

describe("Upcoming on Visits", () => {
  it("lists a visit being booked, as Home does, where FSM has nothing for the client yet", () => {
    expect(upcomingEntries([], null, BOOKING)).toEqual([{ kind: "being_booked", booking: BOOKING }]);
  });

  it("lists it in its day's place among the visits FSM has", () => {
    const before = visit("v1", "2026-10-06");
    const after = visit("v2", "2026-10-20");
    expect(upcomingEntries([before, after], null, BOOKING)).toEqual([
      { kind: "visit", visit: before },
      { kind: "being_booked", booking: BOOKING },
      { kind: "visit", visit: after },
    ]);
  });

  it("lists a booking's consultation only while FSM has no visit of the client's", () => {
    expect(upcomingEntries([], CONSULTATION, null)).toEqual([{ kind: "consultation", consultation: CONSULTATION }]);
    const booked = visit("v1", "2026-10-06");
    expect(upcomingEntries([booked], CONSULTATION, null)).toEqual([{ kind: "visit", visit: booked }]);
  });

  it("lists nothing when nothing is booked or on its way", () => {
    expect(upcomingEntries([], null, null)).toEqual([]);
  });
});

describe("a visit being booked", () => {
  it("is called a consultation and fit when it is one visit, else by its kind", () => {
    expect(bookingName(BOOKING)).toBe("Consultation and fit");
    expect(bookingName({ ...BOOKING, one_visit: null })).toBe("First fit");
    expect(bookingName({ ...BOOKING, type: "service", one_visit: null })).toBe("Service visit");
  });

  it("is called by its kind on a Home the phone kept from before it said whether it is one visit", () => {
    const kept = { type: "service", date: "2026-10-08", window: "morning", paid: true } as BeingBooked;
    expect(bookingName(kept)).toBe("Service visit");
  });

  it("has no price on a Home the phone kept from before it had one, where it said only true or false", () => {
    const kept = { ...BOOKING, one_visit: true } as unknown as BeingBooked;
    expect(bookingName(kept)).toBe("Consultation and fit");
    expect(oneVisitOf(kept)).toBeNull();
    expect(oneVisitOf(BOOKING)).toEqual(PRICE);
  });
});

// Home and Visits never said which hair system a first fit was for.
describe("a visit's title", () => {
  it("names the service beside the kind where the API names one", () => {
    expect(visitTitle({ type: "first_fit", service: "Mane Man Essential" })).toBe("First fit · Mane Man Essential");
    expect(visitTitle({ type: "service", service: null })).toBe("Service visit");
  });

  it("is the kind alone on a visit the phone kept from before the API named the service", () => {
    expect(visitTitle({ type: "first_fit" } as VisitSummary)).toBe("First fit");
  });
});
