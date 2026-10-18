// How long a visit takes and what it holds of a technician's day (src/policy/visit-length.ts;
// docs/decisions/0085-services-ops-can-edit.md).

import { describe, expect, it } from "vitest";
import { UNITS_PER_DAY, VISIT_BLOCKS } from "../../../src/config/scheduling.ts";
import { VISIT_TYPES } from "../../../src/config/visit-types.ts";
import { bookedLength, isServiceLength, SERVICE_MINUTES, unitsFor } from "../../../src/policy/visit-length.ts";

describe("a visit's length", () => {
  it("gives each kind's own length the half-slots its block has always had", () => {
    // Each kind's own length gives the half-slots the design's blocks have always been (ADR 0035).
    expect(VISIT_TYPES.map((type) => [type, VISIT_BLOCKS[type].minutes, unitsFor(VISIT_BLOCKS[type].minutes)])).toEqual(
      VISIT_TYPES.map((type) => [type, VISIT_BLOCKS[type].minutes, VISIT_BLOCKS[type].units]),
    );
    expect(unitsFor(60)).toBe(2);
    expect(unitsFor(90)).toBe(2);
    expect(unitsFor(135)).toBe(3);
    expect(unitsFor(180)).toBe(4);
  });

  it("keeps a whole slot for the shortest visit, and a half-slot more for each 45 minutes past a slot", () => {
    expect(unitsFor(30)).toBe(2);
    expect(unitsFor(91)).toBe(3);
    expect(unitsFor(136)).toBe(4);
    expect(unitsFor(240)).toBe(6);
    expect(unitsFor(360)).toBe(UNITS_PER_DAY);
  });

  it("lets a service run from half an hour to what the day holds, in whole minutes", () => {
    expect(SERVICE_MINUTES).toEqual({ min: 30, max: 360 });
    expect([30, 90, 360].map(isServiceLength)).toEqual([true, true, true]);
    expect([29, 361, 90.5].map(isServiceLength)).toEqual([false, false, false]);
  });

  it("holds a visit already booked for the longer of its service's length and FSM's", () => {
    expect(bookedLength(90, 60)).toBe(90);
    expect(bookedLength(90, 150)).toBe(150);
    expect(bookedLength(135, null)).toBe(135);
  });
});
