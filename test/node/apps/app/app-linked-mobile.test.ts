// What the site hands the client app's login after the #: the number typed there, or a sign-in for a number it proved
// (apps/app/src/login/linked-mobile.ts).

import { describe, expect, it } from "vitest";
import { carriesLogin, mobileInLink, signInInLink } from "../../../../apps/app/src/login/linked-mobile.ts";

const CHALLENGE = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

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
    expect(carriesLogin("#mobile=9810000000")).toBe(true);
    expect(carriesLogin("#mobile=12345")).toBe(true);
    expect(carriesLogin("#x=1")).toBe(false);
    expect(carriesLogin("")).toBe(false);
  });
});

describe("the sign-in a link hands over", () => {
  it("is the challenge and its six-digit code after #signin=", () => {
    expect(signInInLink(`#signin=${CHALLENGE}.123456`)).toEqual({ challengeId: CHALLENGE, code: "123456" });
  });

  it("is nothing for a malformed one, or a number's link", () => {
    for (const hash of ["#signin=", `#signin=${CHALLENGE}`, `#signin=${CHALLENGE}.12345`, "#signin=x.123456"]) {
      expect(signInInLink(hash), hash).toBeNull();
    }
    expect(signInInLink("#mobile=9810000000")).toBeNull();
  });

  it("is taken off the address, read or not", () => {
    expect(carriesLogin(`#signin=${CHALLENGE}.123456`)).toBe(true);
    expect(carriesLogin("#signin=junk")).toBe(true);
  });
});
