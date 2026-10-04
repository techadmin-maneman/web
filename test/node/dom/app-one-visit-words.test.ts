// What the client app's card says of a consultation and fit in one visit (apps/app/src/home/one-visit-words.ts), and
// what it calls the visit and how long it says it is. BK-15 and CP-01: it read "First fit · 180 minutes", with no price
// and no word of the link it is paid by.

import { describe, expect, it } from "vitest";
import type { VisitSummary } from "../../../apps/app/src/api.ts";
import { home, visitLength } from "../../../apps/app/src/content.ts";
import { oneVisitLines } from "../../../apps/app/src/home/one-visit-words.ts";
import { summaryName } from "../../../apps/app/src/lib/visit.ts";

const PRICE = { amount: 3_000_000, from: false, code: null };

describe("a one visit's card", () => {
  it("says what it costs once fitted, only if the client goes ahead, and that a link comes by text", () => {
    expect(oneVisitLines(PRICE)).toEqual([
      "Rs. 30,000, only if you go ahead",
      "Paid once fitted, by a link we text you",
    ]);
  });

  it("says where the prices start when the hair systems differ, and names the code taken off", () => {
    expect(oneVisitLines({ amount: 2_700_000, from: true, code: "TENPC" })).toEqual([
      "From Rs. 27,000, only if you go ahead",
      "Code TENPC applied",
      "Paid once fitted, by a link we text you",
    ]);
  });

  it("says nothing is to pay when the code covers it, and only that it is paid by link while nothing is priced", () => {
    expect(oneVisitLines({ amount: 0, from: false, code: "FITFREE" })).toEqual([
      "Nothing to pay: code FITFREE covers it",
    ]);
    expect(oneVisitLines({ amount: null, from: false, code: null })).toEqual([
      "You pay only if you go ahead",
      "Paid once fitted, by a link we text you",
    ]);
  });
});

describe("a visit's name and length", () => {
  const summary = (oneVisit: VisitSummary["one_visit"] | undefined) =>
    ({ type: "first_fit", ...(oneVisit === undefined ? {} : { one_visit: oneVisit }) }) as VisitSummary;

  it("calls a one visit a consultation and fit, and a first fit by its own name", () => {
    expect(summaryName(summary(PRICE))).toBe("Consultation and fit");
    expect(summaryName(summary(null))).toBe("First fit");
    // A visit the phone kept from a release before one visits had a price.
    expect(summaryName(summary(undefined))).toBe("First fit");
  });

  it("gives the length in hours and minutes, as booking does", () => {
    expect(home.next.length("Consultation and fit", 180)).toBe("Consultation and fit · 3 hours");
    expect(home.next.length("Service visit", 90)).toBe("Service visit · 1 hour 30 minutes");
    expect(visitLength(60)).toBe("1 hour");
    expect(visitLength(45)).toBe("45 minutes");
  });
});
