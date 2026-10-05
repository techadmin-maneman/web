// The two figures the owner ruled for pieces on 24 September 2026
// (src/config/pieces.ts): the replacement cycle, and the label a technician
// types. Both are read by the job sheet and by the mirror of FSM's assets, so
// they are pinned here rather than only in what they compute.

import { describe, expect, it } from "vitest";
import { cycleDaysFor, DEFAULT_PIECE_CYCLE_DAYS, isPieceCode } from "../../../src/config/pieces.ts";

describe("the replacement cycle", () => {
  it("is 180 days, the same for every base", () => {
    expect(DEFAULT_PIECE_CYCLE_DAYS).toBe(180);
    for (const base of ["Standard base", "Mono", "Lace", "PLACEHOLDER_STANDARD"]) {
      expect(cycleDaysFor(base), base).toBe(180);
    }
  });

  it("gives a piece whose base FSM did not name the same cycle as one it did", () => {
    expect(cycleDaysFor(null)).toBe(cycleDaysFor("Standard base"));
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
