// The client's address as their Books customer holds it (src/domain/profile.ts), within what Zoho keeps
// (src/lib/zoho-text.ts).

import { describe, expect, it } from "vitest";
import { streetOf } from "../../../src/domain/profile.ts";
import { STREET_MAX, zohoText } from "../../../src/lib/zoho-text.ts";

const ADDRESS = {
  flat: "Flat 402",
  floor: "4",
  tower: "C",
  line1: "Palm Grove Society",
  line2: "Golf Course Extension Road",
  landmark: "Opposite the park",
  locality: "Sector 65",
};

describe("streetOf", () => {
  it("puts the door on the first line and the way to it on the second", () => {
    expect(streetOf(ADDRESS)).toEqual({
      street1: "Flat 402, Floor 4, Tower C, Palm Grove Society",
      street2: "Golf Course Extension Road, Sector 65, Landmark: Opposite the park",
    });
  });

  it("names no part the client already named", () => {
    const named = { ...ADDRESS, floor: "4th floor", tower: "Block C", landmark: "Landmark: the park" };
    expect(streetOf(named)).toEqual({
      street1: "Flat 402, 4th floor, Block C, Palm Grove Society",
      street2: "Golf Course Extension Road, Sector 65, Landmark: the park",
    });
  });

  it("leaves out a part not given, or given blank", () => {
    const bare = { ...ADDRESS, floor: null, tower: " ", line2: "", landmark: null };
    expect(streetOf(bare)).toEqual({ street1: "Flat 402, Palm Grove Society", street2: "Sector 65" });
  });

  it("reads an address saved before the flat was asked for as it did", () => {
    const older = { flat: null, floor: null, tower: null, line1: "House 12", line2: null, landmark: null };
    expect(streetOf({ ...older, locality: null })).toEqual({ street1: "House 12", street2: null });
    expect(streetOf({ ...older, locality: "Sector 65" })).toEqual({ street1: "House 12", street2: "Sector 65" });
  });

  it("keeps each line within what Zoho takes, at the longest every part may be", () => {
    const longest = {
      flat: "f".repeat(40),
      floor: "1".repeat(20),
      tower: "t".repeat(40),
      line1: "b".repeat(120),
      line2: "s".repeat(120),
      landmark: "l".repeat(120),
      locality: "a".repeat(80),
    };
    const { street1, street2 } = streetOf(longest);
    expect(street1.length).toBeLessThanOrEqual(STREET_MAX);
    expect(street1).toMatch(/^f{40}, Floor 1{20}, Tower t{40}, b{120}$/);
    expect(street2).toHaveLength(STREET_MAX);
    expect(street2).toMatch(/^s{120}, a{80}, Landmark: l+…$/);
  });
});

describe("zohoText", () => {
  it("leaves out what Zoho would cut the rest at, and keeps what it keeps", () => {
    expect(zohoText("Ring twice 🙏 the bell is broken", 500)).toBe("Ring twice the bell is broken");
    expect(zohoText("Tower B 🇮🇳", 255)).toBe("Tower B");
    expect(zohoText("गेट पर कॉल करें ✅ ❤️ Rs. 500 “quoted”", 500)).toBe("गेट पर कॉल करें ✅ ❤️ Rs. 500 “quoted”");
    expect(zohoText("line one\nline two", 500)).toBe("line one\nline two");
  });

  it("ends text too long in an ellipsis, within the most Zoho takes", () => {
    expect(zohoText("x".repeat(256), 255)).toBe(`${"x".repeat(254)}…`);
    expect(zohoText("x".repeat(255), 255)).toBe("x".repeat(255));
  });
});
