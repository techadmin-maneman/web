// The starts a client is offered (src/policy/steering.ts, ADR 0293): above the driving ops allow, a start is not
// offered unless it is the day's last; of those offered, the cheapest few are marked Recommended.

import { describe, expect, it } from "vitest";
import { steer, STEERING } from "../../../src/policy/steering.ts";

/** A start its best technician would drive `addedDrive` minutes for, at a cost of `cost`, their home known unless not. */
const at = (time: string, addedDrive: number, cost = addedDrive, homeKnown = true) => ({
  time,
  takers: [{ addedDrive, cost, homeKnown }],
});

const shown = (starts: ReturnType<typeof steer>) =>
  starts.map((start) => `${start.time}${start.recommended ? " *" : ""}`);

describe("steering a day's starts", () => {
  it("leaves out a start that drives more than the cap beyond the day's best, but never the day's last", () => {
    const day = [at("09:00", 10), at("11:00", 45), at("13:00", 40), at("17:00", 60)];
    expect(shown(steer(day, { recommended: 0, drive_cap: 30 }))).toEqual(["09:00", "13:00", "17:00"]);
  });

  it("keeps every start of a quiet day, whose starts drive alike however far", () => {
    const day = [at("09:00", 70), at("12:00", 70), at("15:00", 70)];
    expect(shown(steer(day, { recommended: 0, drive_cap: 30 }))).toEqual(["09:00", "12:00", "15:00"]);
  });

  it("marks the cheapest it offers, as many as ops set, the earlier first where they cost the same", () => {
    // 13:00 drives more than the cap beyond the day's best, but is the day's last, so it is offered, and unmarked.
    const day = [at("09:00", 25), at("10:00", 5), at("11:00", 15), at("12:00", 5), at("13:00", 40)];
    expect(shown(steer(day, STEERING))).toEqual(["09:00", "10:00 *", "11:00 *", "12:00 *", "13:00"]);
    expect(shown(steer(day, { ...STEERING, recommended: 1 }))).toEqual(["09:00", "10:00 *", "11:00", "12:00", "13:00"]);
  });

  it("weighs a start by its best technician's cost, not its driving alone", () => {
    const day = [at("09:00", 10, 60), at("10:00", 20, 20)];
    expect(shown(steer(day, { recommended: 1, drive_cap: 30 }))).toEqual(["09:00", "10:00 *"]);
  });

  it("neither sets the day's best by, nor leaves out, a start whose technician's home is not set", () => {
    // 09:00 is only Zubin's, whose driving nobody can tell: Aditya's starts are weighed against each other, and the
    // marked are Aditya's, as booking puts a known home first.
    const day = [at("09:00", 0, 30, false), at("11:00", 90), at("13:00", 95), at("15:00", 200)];
    expect(shown(steer(day, { recommended: 2, drive_cap: 30 }))).toEqual(["09:00", "11:00 *", "13:00 *", "15:00"]);
  });

  it("marks nothing where ops set none, and offers nothing on a day with no start", () => {
    expect(shown(steer([at("09:00", 5)], { recommended: 0, drive_cap: 30 }))).toEqual(["09:00"]);
    expect(steer([], STEERING)).toEqual([]);
  });
});
