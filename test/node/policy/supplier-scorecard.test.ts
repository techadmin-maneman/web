// The supplier scorecard's figures (src/policy/supplier-scorecard.ts; docs/decisions/0172-supplier-scorecard.md).

import { describe, expect, it } from "vitest";
import { daysBetween, scorecardOf, type ScoredOrder } from "../../../src/policy/supplier-scorecard.ts";

const order = (over: Partial<ScoredOrder>): ScoredOrder => ({
  state: "received",
  sentOn: "2026-09-01",
  dueOn: "2026-09-15",
  firstReceivedOn: "2026-09-14",
  lastReceivedOn: "2026-09-14",
  promisedDays: 14,
  ...over,
});

const NO_UNITS = { received: 0, damaged: 0, failed: 0 };
const NO_CLAIMS = { settled: 0, accepted: 0, credited: 0 };

describe("a supplier's scorecard", () => {
  it("counts an order on time in full only when it all arrived by its due day", () => {
    const card = scorecardOf(
      [
        order({}),
        order({ lastReceivedOn: "2026-09-20" }),
        order({ state: "closed" }),
        order({ state: "part_received" }),
        order({ dueOn: null }),
      ],
      NO_UNITS,
      NO_CLAIMS,
    );
    expect(card.orders).toBe(5);
    expect(card.onTimeInFull).toBe(33);
  });

  it("averages the days to the first receipt against the days promised", () => {
    const card = scorecardOf(
      [
        order({ firstReceivedOn: "2026-09-11" }),
        order({ firstReceivedOn: "2026-09-18", promisedDays: 21 }),
        order({ firstReceivedOn: null }),
      ],
      NO_UNITS,
      NO_CLAIMS,
    );
    expect([card.leadDays, card.promisedDays]).toEqual([13.5, 16.3]);
  });

  it("reads what arrived damaged or failed its check as a share of all that arrived, and nothing as no figure", () => {
    const card = scorecardOf([], { received: 90, damaged: 4, failed: 6 }, { settled: 3, accepted: 2, credited: 1250 });
    expect([card.failedPercent, card.damagedPercent, card.onTimeInFull, card.leadDays]).toEqual([6, 4, null, null]);
    expect(card.claims).toEqual({ settled: 3, accepted: 2, credited: 1250 });
    expect(scorecardOf([], NO_UNITS, NO_CLAIMS).failedPercent).toBeNull();
  });

  it("counts whole days between India dates", () => {
    expect(daysBetween("2026-09-01", "2026-10-01")).toBe(30);
  });
});
