// What the client app's Visits lists under Upcoming (apps/app/src/visits/upcoming.ts), and what a visit being booked
// is called. D-04: while FSM held a booking, Home said "We are booking your visit." and Visits said "Nothing booked
// yet."; Home also called a consultation and fit in one visit a first fit.

import { describe, expect, it } from "vitest";
import type { Me, VisitSummary } from "../../apps/app/src/api.ts";
import { bookingName } from "../../apps/app/src/lib/visit.ts";
import { upcomingEntries } from "../../apps/app/src/visits/upcoming.ts";

type BeingBooked = NonNullable<Me["being_booked"]>;

const visit = (id: string, date: string): VisitSummary => ({ id, date }) as VisitSummary;

const BOOKING: BeingBooked = {
  type: "first_fit",
  date: "2026-10-08",
  window: "morning",
  paid: false,
  one_visit: true,
  told: false,
};
const CONSULTATION = {
  date: "2026-10-06",
  window: "morning",
  window_label: "before noon",
  place: "Gurgaon",
  requested: false,
  one_visit: false,
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
    expect(bookingName({ ...BOOKING, one_visit: false })).toBe("First fit");
    expect(bookingName({ ...BOOKING, type: "service", one_visit: false })).toBe("Service visit");
  });

  it("is called by its kind on a Home the phone kept from before it said whether it is one visit", () => {
    const kept = { type: "service", date: "2026-10-08", window: "morning", paid: true } as BeingBooked;
    expect(bookingName(kept)).toBe("Service visit");
  });
});
