// Where a client may move their address from the app, each rule named by its own words (src/policy/address-change.ts).

import { describe, expect, it } from "vitest";
import { addressRefusal, RULES } from "../../src/policy/address-change.ts";

describe("moving the address visits go to", () => {
  it(RULES[0], () => {
    expect(addressRefusal({ served: true, city: "Gurgaon", visitCities: [] })).toBeNull();
    expect(addressRefusal({ served: false, city: "Gurgaon", visitCities: [] })).toBe("not_served");
    expect(addressRefusal({ served: false, city: null, visitCities: [] })).toBe("not_served");
  });

  it(RULES[1], () => {
    expect(addressRefusal({ served: true, city: "Gurgaon", visitCities: ["Gurgaon"] })).toBeNull();
    expect(addressRefusal({ served: true, city: "Delhi", visitCities: ["Gurgaon"] })).toBe("visit_booked");
    expect(addressRefusal({ served: true, city: "Gurgaon", visitCities: ["Gurgaon", "Delhi"] })).toBe("visit_booked");
  });
});
