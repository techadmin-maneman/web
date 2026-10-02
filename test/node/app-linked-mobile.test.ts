// The number the site's booking confirmation hands the client app's login (apps/app/src/login/linked-mobile.ts).

import { describe, expect, it } from "vitest";
import { carriesMobile, mobileInLink } from "../../apps/app/src/login/linked-mobile.ts";

describe("the number a link fills in", () => {
  it("is the ten digits after #mobile=", () => {
    expect(mobileInLink("#mobile=9810000000")).toBe("9810000000");
  });

  it("is nothing for no link, another fragment, or digits that are not an Indian mobile number", () => {
    for (const hash of ["", "#", "#mobile=", "#mobile=12345", "#mobile=1810000000", "#mobile=98100000001", "#x=1"]) {
      expect(mobileInLink(hash), hash).toBe("");
    }
  });

  it("is taken off the address whenever the link carried one, even one not read", () => {
    expect(carriesMobile("#mobile=9810000000")).toBe(true);
    expect(carriesMobile("#mobile=12345")).toBe(true);
    expect(carriesMobile("#x=1")).toBe(false);
    expect(carriesMobile("")).toBe(false);
  });
});
