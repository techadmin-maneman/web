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

const inside: Taking = { overflow: false, piece: null, homeKnown: true };

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
    const ring: Taking = { overflow: true, piece: null, homeKnown: true };
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

  it("never moves a draft to a technician with no home pin while one whose home is known can keep it", () => {
    // Bina has no home pin, so her driving counts nothing; Aman lives 40 km off, and keeps the draft.
    const plan = replan({
      drafts: [draft("d1", "10:00", 40, "A", { A: inside, B: { overflow: true, piece: null, homeKnown: false } })],
      crew: crewOf({ A: day(0), B: { ...day(0), home: null } }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(plan.get("d1")).toBe("A");
  });

  it("sends a fit to whoever holds its piece, over a little less driving", () => {
    // Bhavesh lives 10 km nearer, but the piece is in Aman's kit and nowhere else in the city.
    const plan = replan({
      drafts: [
        draft("d1", "10:00", 30, "B", {
          A: { overflow: false, piece: "kit", homeKnown: true },
          B: { overflow: false, piece: "none", homeKnown: true },
        }),
      ],
      crew: crewOf({ A: day(15), B: day(25) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(plan.get("d1")).toBe("A");
  });

  it("moves a draft off a day that no longer fits it, to whoever it costs least, and re-plans the rest", () => {
    // Chetan's leave now covers his draft. Aman's goes to Bhavesh; Chetan's to Aman, 20 km out and back, rather than
    // Bhavesh, whose day it would lengthen by 50.
    const away = { ...day(20), away: [{ from: minuteOf("09:00"), to: minuteOf("20:00") }] };
    const plan = replan({
      drafts: [
        draft("d1", "10:00", 45, "A", { A: inside, B: inside }),
        draft("d2", "14:00", 20, "C", { A: inside, B: inside, C: inside }),
      ],
      crew: crewOf({ A: day(0), B: day(50), C: away }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect([plan.get("d1"), plan.get("d2")]).toEqual(["B", "A"]);
  });

  it("moves only the drafts a day no longer fits, and keeps the rest where they cost least", () => {
    // Chetan's leave from 2:30 covers his 3 o'clock draft alone. His 10 o'clock one, 10 km from his home and 50 from
    // Aman's, stays his: Aman taking both would drive 100 against their 76.
    const partly = { ...day(10), away: [{ from: minuteOf("14:30"), to: minuteOf("16:30") }] };
    const plan = replan({
      drafts: [
        draft("d1", "10:00", 0, "C", { A: inside, C: inside }),
        draft("d2", "15:00", 22, "C", { A: inside, C: inside }),
      ],
      crew: crewOf({ A: day(50), C: partly }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect([plan.get("d1"), plan.get("d2")]).toEqual(["C", "A"]);
  });

  it("moves the drafts of a technician away all day, who has no day to plan", () => {
    const plan = replan({
      drafts: [draft("d1", "10:00", 20, "C", { A: inside, C: inside })],
      crew: crewOf({ A: day(50) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(plan.get("d1")).toBe("A");
  });

  it("places nobody on a draft its day no longer fits that nobody else can take", () => {
    const busy = [{ start: minuteOf("09:30"), end: minuteOf("12:00"), pin: north(50), fit: false }];
    const plan = replan({
      drafts: [draft("d1", "10:00", 20, "C", { A: inside, C: inside })],
      crew: crewOf({ A: day(50, busy) }),
      rules: RULES,
      allotment: ALLOT,
    });
    expect(plan.get("d1")).toBeNull();
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
