// How far a technician goes from home and who of them takes a visit (src/policy/reach.ts, src/policy/allotment.ts,
// ADR 0289), and what a job short of its consumables owes (src/policy/consumable-shortfall.ts, ADR 0222).

import { describe, expect, it } from "vitest";
import { ALLOTMENT, costOf } from "../../../src/policy/allotment.ts";
import { ringKm, standingOf } from "../../../src/policy/reach.ts";
import { needsReason, shortfallOf } from "../../../src/policy/consumable-shortfall.ts";

const HOME = { lat: 28.4595, lng: 77.0266 };
/** A pin `km` due north of home. */
const north = (km: number) => ({ lat: HOME.lat + km / 111.195, lng: HOME.lng });

describe("a technician's radius", () => {
  const standing = (km: number) => standingOf({ home: HOME, to: north(km), radiusKm: 10, overflow: 150 });

  it("takes in what is inside it, puts what is in the ring past it in the overflow, and leaves out the rest", () => {
    expect(standing(4)).toBe("inside");
    expect(standing(9.9)).toBe("inside");
    expect(standing(12)).toBe("overflow");
    expect(standing(14.9)).toBe("overflow");
    expect(standing(15.5)).toBe("beyond");
    expect(ringKm(10, 150)).toBe(15);
  });

  it("puts a technician with no home in the ring, and leaves an address with no pin to the city", () => {
    expect(standingOf({ home: null, to: north(1), radiusKm: 10, overflow: 150 })).toBe("overflow");
    expect(standingOf({ home: HOME, to: null, radiusKm: 10, overflow: 150 })).toBe("inside");
  });
});

describe("what a technician taking a visit costs", () => {
  const taking = { addedDrive: 20, overflow: false, piece: null, weekMinutes: 600 };

  it("is the driving it adds, where nothing else counts", () => {
    expect(costOf(taking, 600, ALLOTMENT)).toBe(20);
  });

  it("adds the ring, a piece to fetch or find, and each hour more booked that week than the least", () => {
    expect(costOf({ ...taking, overflow: true }, 600, ALLOTMENT)).toBe(50);
    expect(costOf({ ...taking, piece: "kit" }, 600, ALLOTMENT)).toBe(20);
    expect(costOf({ ...taking, piece: "stockroom" }, 600, ALLOTMENT)).toBe(50);
    expect(costOf({ ...taking, piece: "none" }, 600, ALLOTMENT)).toBe(110);
    expect(costOf(taking, 420, ALLOTMENT)).toBe(50);
  });

  it("lets a kit holder a little further away win over one nearer who would need the piece found", () => {
    const holder = costOf({ ...taking, addedDrive: 45, piece: "kit" }, 600, ALLOTMENT);
    const nearer = costOf({ ...taking, addedDrive: 15, piece: "none" }, 600, ALLOTMENT);
    expect(holder).toBeLessThan(nearer);
  });
});

describe("a job short of its consumables", () => {
  const expected = [
    { code: "tape", expected: 4 },
    { code: "solvent", expected: 20 },
    { code: "shampoo", expected: 0 },
  ];

  it("owes a reason for any consumable below what is expected, naming each", () => {
    const shortfall = shortfallOf({
      type: "service",
      expected,
      used: new Map([
        ["tape", 4],
        ["solvent", 10],
      ]),
      total: 14,
    });
    expect(shortfall).toEqual({ short: [{ code: "solvent", expected: 20, used: 10 }], nothing: false });
    expect(needsReason(shortfall)).toBe(true);
  });

  it("owes none for what is expected or more, and one for nothing on any visit but a consultation", () => {
    const asExpected = new Map([
      ["tape", 5],
      ["solvent", 20],
    ]);
    expect(needsReason(shortfallOf({ type: "service", expected, used: asExpected, total: 25 }))).toBe(false);
    expect(shortfallOf({ type: "first_fit", expected: [], used: new Map(), total: 0 })).toEqual({
      short: [],
      nothing: true,
    });
    expect(needsReason(shortfallOf({ type: "consultation", expected: [], used: new Map(), total: 0 }))).toBe(false);
  });
});
