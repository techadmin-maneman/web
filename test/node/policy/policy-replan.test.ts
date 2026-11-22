// The re-plan of a day's drafts (src/policy/replan.ts, ADR 0290): each keeps its time, and goes to whoever it costs
// least in all, by moves and swaps that still fit every day. Pins sit due north of a point, a kilometre a minute.

import { describe, expect, it } from "vitest";
import { ALLOTMENT } from "../../../src/policy/allotment.ts";
import { minuteOf, type PlanDay, type PlanRules } from "../../../src/policy/day-plan.ts";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { replan, type Draft, type Taking } from "../../../src/policy/replan.ts";
import { BOOKING_RULES } from "../../../src/policy/start-times.ts";

const ORIGIN = { lat: 28.4, lng: 77.05 };
const north = (km: number) => ({ lat: ORIGIN.lat + km / 111.195, lng: ORIGIN.lng });

const RULES: PlanRules = {
  booking: BOOKING_RULES,
  drive: { ...DRIVE_ESTIMATE, road_factor: 100, peak_kmh: 60, offpeak_kmh: 60, parking: 0, least: 10 },
};
// Driving and the ring alone, unless a test says: no fair share to blur the sums.
const ALLOT = { ...ALLOTMENT, share_cost: 0 };

const day = (homeKm: number, stops: PlanDay["stops"] = []): PlanDay => ({
  opens: minuteOf("09:00"),
  closes: minuteOf("20:00"),
  home: north(homeKm),
  stops,
  away: [],
});

const inside: Taking = { overflow: false, piece: null };

function draft(id: string, at: string, km: number, technicianId: string, takers: Record<string, Taking>): Draft {
  const start = minuteOf(at);
  return {
    id,
    stop: { start, end: start + 60, pin: north(km), fit: false },
    technicianId,
    takers: new Map(Object.entries(takers)),
  };
}

const crewOf = (days: Record<string, PlanDay>) => ({
  days: new Map(Object.entries(days)),
  weekMinutes: new Map(Object.keys(days).map((id) => [id, 0])),
});

describe("a day's re-plan", () => {
  it("moves a draft to the technician it costs less to drive", () => {
    const plan = replan({
      drafts: [draft("d1", "10:00", 45, "A", { A: inside, B: inside })],
      crew: crewOf({ A: day(0), B: day(50) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(plan.get("d1")).toBe("B");
  });

  it("keeps a draft where the other technician's day has no room for it", () => {
    const busy = [{ start: minuteOf("10:00"), end: minuteOf("11:30"), pin: north(50), fit: false }];
    const plan = replan({
      drafts: [draft("d1", "10:00", 45, "A", { A: inside, B: inside })],
      crew: crewOf({ A: day(0), B: day(50, busy) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(plan.get("d1")).toBe("A");
  });

  it("swaps two drafts at the same time, where neither could move alone", () => {
    const plan = replan({
      drafts: [
        draft("d1", "10:00", 45, "A", { A: inside, B: inside }),
        draft("d2", "10:00", 5, "B", { A: inside, B: inside }),
      ],
      crew: crewOf({ A: day(0), B: day(50) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect([plan.get("d1"), plan.get("d2")]).toEqual(["B", "A"]);
  });

  it("sends a draft into someone's ring only where the driving saved outweighs the ring's cost", () => {
    const ring: Taking = { overflow: true, piece: null };
    // From 28 km, Bhavesh at 50 drives 44 there and back against Aman's 56: 12 saved, under the ring's 30.
    const near = replan({
      drafts: [draft("d1", "10:00", 28, "A", { A: inside, B: ring })],
      crew: crewOf({ A: day(0), B: day(50) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(near.get("d1")).toBe("A");
    // From 45 km, he drives 10 against 90: 80 saved.
    const far = replan({
      drafts: [draft("d1", "10:00", 45, "A", { A: inside, B: ring })],
      crew: crewOf({ A: day(0), B: day(50) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(far.get("d1")).toBe("B");
  });

  it("never gives a draft to a technician who may not take it, however near", () => {
    const plan = replan({
      drafts: [draft("d1", "10:00", 45, "A", { A: inside })],
      crew: crewOf({ A: day(0), B: day(50) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(plan.get("d1")).toBe("A");
  });

  it("evens out the week where the driving is the same", () => {
    const plan = replan({
      drafts: [draft("d1", "10:00", 10, "A", { A: inside, B: inside })],
      crew: {
        days: new Map([
          ["A", day(0)],
          ["B", day(0)],
        ]),
        weekMinutes: new Map([
          ["A", 600],
          ["B", 120],
        ]),
      },
      rules: RULES,
      allotment: ALLOTMENT,
    });
    expect(plan.get("d1")).toBe("B");
  });
});
