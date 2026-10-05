// The stock ledger (src/policy/stock.ts; docs/decisions/0087-consumables-and-stock.md).
// "These are ours because FSM has no place for them, not because they compete with FSM. Everything FSM does
// hold is written to FSM." Stock is one of them: FSM counts none without Zoho Inventory.

import { describe, expect, it } from "vitest";
import { countDifference, isLow, useStillToRecord } from "../../../src/policy/stock.ts";

describe("stock, which is ours", () => {
  it("is low at its reorder level and below it, and never where no level is set", () => {
    expect(isLow(5, 5)).toBe(true);
    expect(isLow(4, 5)).toBe(true);
    expect(isLow(-2, 0)).toBe(true);
    expect(isLow(6, 5)).toBe(false);
    expect(isLow(0, null)).toBe(false);
  });

  it("counts the difference between what was counted and what the ledger said, nought when they agree", () => {
    expect(countDifference(48, 50)).toBe(-2);
    expect(countDifference(50, 50)).toBe(0);
    expect(countDifference(10, -3)).toBe(13);
  });
});

describe("a job's use", () => {
  const map = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it("takes the whole of what the first step says was used out of the kit", () => {
    expect(useStillToRecord(map({ tape: 4, solvent: 10 }), map({}))).toEqual(map({ tape: -4, solvent: -10 }));
  });

  it("takes nothing more for the same step, however often it lands", () => {
    expect(useStillToRecord(map({ tape: 4 }), map({ tape: -4 }))).toEqual(map({}));
  });

  it("corrects a later step by the difference, giving back what it no longer names", () => {
    expect(useStillToRecord(map({ tape: 6 }), map({ tape: -4, solvent: -10 }))).toEqual(map({ tape: -2, solvent: 10 }));
    expect(useStillToRecord(map({}), map({ tape: -4 }))).toEqual(map({ tape: 4 }));
  });
});
