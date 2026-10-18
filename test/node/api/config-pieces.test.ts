// The label a technician types for a piece (src/config/pieces.ts), read by the job sheet and by the mirror of FSM's
// assets, so it is pinned here rather than only in what it computes. When a piece falls due is its package's
// (src/policy/packages.ts).

import { describe, expect, it } from "vitest";
import { isPieceCode } from "../../../src/config/pieces.ts";
import { monthsAfter } from "../../../src/lib/india-time.ts";
import { REPLACE_AFTER_MONTHS } from "../../../src/policy/packages.ts";

describe("when a piece falls due", () => {
  it("is six months after its fit for a new package, the same day of the month", () => {
    expect(REPLACE_AFTER_MONTHS.start).toBe(6);
    expect(monthsAfter("2026-09-21", REPLACE_AFTER_MONTHS.start)).toBe("2027-03-21");
  });

  it("is the month's last day where the month is shorter", () => {
    expect(monthsAfter("2026-08-31", 6)).toBe("2027-02-28");
    expect(monthsAfter("2027-08-31", 6)).toBe("2028-02-29");
  });
});

describe("the piece label", () => {
  it("is MM, a base code, digits and a letter, in capitals", () => {
    expect(isPieceCode("MM-STD-4417-B")).toBe(true);
    expect(isPieceCode("MM-MONO-12-A")).toBe(true);
  });

  it("refuses what is not that shape, so a mistyped code is not taken for a piece", () => {
    for (const code of ["mm-std-4417-b", "MM-STD-4417", "MM-STD-4417-BB", "STD-4417-B", "MM--4417-B"]) {
      expect(isPieceCode(code), code).toBe(false);
    }
  });
});
