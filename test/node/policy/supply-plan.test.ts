// The supply plan's rules (src/policy/supply-plan.ts; docs/decisions/0180-supply-plan.md).

import { describe, expect, it } from "vitest";
import { lend, needOver, orderQuantity, periodsCovering, shortOf, spareOf } from "../../../src/policy/supply-plan.ts";

describe("the supply plan", () => {
  it("sees across the supplier's lead time and a period more", () => {
    expect(periodsCovering(14, 7)).toBe(3);
    expect(periodsCovering(0, 7)).toBe(1);
    expect(periodsCovering(10, 7)).toBe(3);
  });

  it("needs what the periods it sees expect, with safety stock from their spreads added as spreads add", () => {
    const forecast = [
      { period: 0, expected: 4, high: 7 },
      { period: 1, expected: 2, high: 6 },
      { period: 2, expected: 9, high: 14 },
    ];
    expect(needOver(forecast, 2)).toEqual({ need: 6, safety: 5 });
  });

  it("is short of what the need and safety stock leave over what can be used, and spares the rest", () => {
    expect(shortOf(3, 6, 5)).toBe(8);
    expect(shortOf(20, 6, 5)).toBe(0);
    expect(spareOf(20, 6, 5)).toBe(9);
    expect(spareOf(3, 6, 5)).toBe(0);
  });

  it("orders at least the shortfall and the minimum, in whole packs", () => {
    expect(orderQuantity(13, 12, 24)).toBe(24);
    expect(orderQuantity(30, 12, 24)).toBe(36);
    expect(orderQuantity(5, 1, 1)).toBe(5);
  });

  it("lends from the cities with the most to spare to the city furthest short first, and leaves the rest to buy", () => {
    const { loans, short } = lend(
      [
        { city: "Gurgaon", short: 5 },
        { city: "Noida", short: 9 },
      ],
      [
        { city: "Delhi", spare: 6 },
        { city: "Pune", spare: 2 },
      ],
    );
    expect(loans).toEqual([
      { from: "Delhi", to: "Noida", quantity: 6 },
      { from: "Pune", to: "Noida", quantity: 2 },
    ]);
    expect([...short]).toEqual([
      ["Noida", 1],
      ["Gurgaon", 5],
    ]);
  });
});
