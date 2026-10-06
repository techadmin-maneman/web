// A technician never takes two of a client's visits in a row (src/domain/booking/technician-rotation.ts): who may not take a
// visit of the client's on a day.

import { describe, expect, it } from "vitest";
import { techniciansBarredOn } from "../../../src/domain/booking/technician-rotation.ts";

const IMRAN = "t1";
const SANDEEP = "t2";
const SAMEER = "t3";

describe("who stands beside a client's visit", () => {
  const visits = [
    { date: "2026-08-01", technicianId: SAMEER },
    { date: "2026-09-01", technicianId: IMRAN },
    { date: "2026-10-01", technicianId: SANDEEP },
  ];

  it("is whoever took the visit before that day and whoever has the one after", () => {
    expect(techniciansBarredOn(visits, "2026-09-15")).toEqual(new Set([IMRAN, SANDEEP]));
  });

  it("is only the last before, for a day after every visit, and only the first after, before them all", () => {
    expect(techniciansBarredOn(visits, "2026-10-15")).toEqual(new Set([SANDEEP]));
    expect(techniciansBarredOn(visits, "2026-07-15")).toEqual(new Set([SAMEER]));
  });

  it("counts a visit on the day itself as beside it, and every visit on the nearest days", () => {
    expect(techniciansBarredOn(visits, "2026-09-01")).toEqual(new Set([SAMEER, IMRAN, SANDEEP]));
    const twoOnOneDay = [...visits, { date: "2026-09-01", technicianId: SAMEER }];
    expect(techniciansBarredOn(twoOnOneDay, "2026-09-10")).toEqual(new Set([IMRAN, SAMEER, SANDEEP]));
  });

  it("is nobody for a client with no visits", () => {
    expect(techniciansBarredOn([], "2026-09-15")).toEqual(new Set());
  });
});
