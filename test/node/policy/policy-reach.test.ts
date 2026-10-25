// How far a technician goes from home (src/policy/reach.ts, ADR 0223), and what a job short of its consumables owes
// (src/policy/consumable-shortfall.ts, ADR 0222).

import { describe, expect, it } from "vitest";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { reachKm, reachMinutes, TECHNICIAN_REACH_MIN, withinReach } from "../../../src/policy/reach.ts";
import { needsReason, shortfallOf } from "../../../src/policy/consumable-shortfall.ts";

const HOME = { lat: 28.4595, lng: 77.0266 };
/** About 4 km north, and about 30 km north. */
const NEAR = { lat: 28.4955, lng: 77.0266 };
const FAR = { lat: 28.7295, lng: 77.0266 };

describe("a technician's reach", () => {
  it("takes in what the estimate drives within it, and leaves out what it does not", () => {
    expect(reachMinutes(HOME, NEAR, DRIVE_ESTIMATE)).toBeLessThan(TECHNICIAN_REACH_MIN);
    expect(withinReach({ home: HOME, to: NEAR, reach: 45, estimate: DRIVE_ESTIMATE })).toBe(true);
    expect(withinReach({ home: HOME, to: FAR, reach: 45, estimate: DRIVE_ESTIMATE })).toBe(false);
    expect(withinReach({ home: HOME, to: FAR, reach: 180, estimate: DRIVE_ESTIMATE })).toBe(true);
  });

  it("leaves it to the city where a home or the address has no pin", () => {
    expect(withinReach({ home: null, to: FAR, reach: 10, estimate: DRIVE_ESTIMATE })).toBe(true);
    expect(withinReach({ home: HOME, to: null, reach: 10, estimate: DRIVE_ESTIMATE })).toBe(true);
  });

  it("draws as the straight-line kilometres the estimate runs backwards, the time to park left out", () => {
    // 45 minutes, ten of them to park: 35 minutes at 24 km/h is 14 km of road, 10 km in a straight line at 140%.
    expect(reachKm(45, DRIVE_ESTIMATE)).toBeCloseTo(10, 5);
    expect(reachKm(5, DRIVE_ESTIMATE)).toBe(0);
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
