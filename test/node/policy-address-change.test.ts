// Where a client may move their address from the app (src/policy/address-change.ts).

import { describe, expect, it } from "vitest";
import { addressRefusal } from "../../src/policy/address-change.ts";

describe("moving the address visits go to", () => {
  it("refuses an address in a pincode we do not serve, or do not know", () => {
    expect(addressRefusal({ served: true, city: "Gurgaon", visitCities: [] })).toBeNull();
    expect(addressRefusal({ served: false, city: "Gurgaon", visitCities: [] })).toBe("not_served");
    expect(addressRefusal({ served: false, city: null, visitCities: [] })).toBe("not_served");
  });

  it("keeps a changed address in the city of every visit booked", () => {
    expect(addressRefusal({ served: true, city: "Gurgaon", visitCities: ["Gurgaon"] })).toBeNull();
    expect(addressRefusal({ served: true, city: "Delhi", visitCities: ["Gurgaon"] })).toBe("visit_booked");
    expect(addressRefusal({ served: true, city: "Gurgaon", visitCities: ["Gurgaon", "Delhi"] })).toBe("visit_booked");
  });
});
