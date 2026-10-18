// What a package is made of and what its visits cost (src/policy/packages.ts, docs/decisions/0211-packages.md), and
// the service visit and replacement a client on one is offered (src/policy/services.ts).

import { describe, expect, it } from "vitest";
import { lowestPrice, priceOfParts, serviceNameOf } from "../../../src/policy/packages.ts";
import { forPackage } from "../../../src/policy/services.ts";

const price = (amountExGst: number, gstPercent: number) => ({
  amount_ex_gst: amountExGst,
  amount: Math.round((amountExGst * (100 + gstPercent)) / 100),
  gst_percent: gstPercent,
});

describe("a visit's price from its parts", () => {
  it("adds the parts before GST, at the GST of the first, what the visit is chiefly for", () => {
    expect(priceOfParts([price(2_980_000, 18), price(220_000, 5)])).toEqual({
      amount_ex_gst: 3_200_000,
      amount: 3_776_000,
      gst_percent: 18,
    });
  });

  it("is no price where a part has none: nothing is sold at no price", () => {
    expect(priceOfParts([price(2_980_000, 0), null])).toBeNull();
    expect(priceOfParts([null, price(220_000, 0)])).toBeNull();
    expect(priceOfParts([])).toBeNull();
  });

  it("starts a package's first fit from its cheapest hair system", () => {
    expect(lowestPrice([price(3_000_000, 0), price(2_500_000, 0), price(4_000_000, 0)])).toMatchObject({
      amount_ex_gst: 2_500_000,
    });
    expect(lowestPrice([])).toBeNull();
  });
});

describe("a package's services", () => {
  it("are named from it: its first fit is the package, the others add their kind", () => {
    expect(serviceNameOf("Mane Man Essential", "first_fit")).toBe("Mane Man Essential");
    expect(serviceNameOf("Mane Man Essential", "service")).toBe("Mane Man Essential service visit");
    expect(serviceNameOf("Mane Man Essential", "replacement")).toBe("Mane Man Essential replacement");
  });

  it("offer a client their package's service visit and replacement, else the standard ones, and pass others", () => {
    const services = [
      { kind: "consultation", tier: "standard" },
      { kind: "first_fit", tier: "essential" },
      { kind: "service", tier: "standard" },
      { kind: "service", tier: "essential" },
      { kind: "replacement", tier: "standard" },
      { kind: "replacement", tier: "essential" },
    ] as const;
    expect(forPackage(services, "essential").map((each) => `${each.kind}/${each.tier}`)).toEqual([
      "consultation/standard",
      "first_fit/essential",
      "service/essential",
      "replacement/essential",
    ]);
    expect(forPackage(services, null).map((each) => `${each.kind}/${each.tier}`)).toEqual([
      "consultation/standard",
      "first_fit/essential",
      "service/standard",
      "replacement/standard",
    ]);
  });
});
