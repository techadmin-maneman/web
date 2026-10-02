// The booking form's helpers.

import { describe, expect, it } from "vitest";
import { addressToSend, emptyAddress, missingParts } from "../../site/src/lib/address.ts";
import { signInLink } from "../../site/src/lib/app-link.ts";
import { attributionFrom } from "../../site/src/lib/attribution.ts";
import { keyPerRequest } from "../../site/src/lib/idempotency.ts";

// FEO-21: a key that changed on every press protected nothing.
describe("idempotency keys", () => {
  it("are the same for the same request pressed again, and new once anything in it changes", () => {
    const keyFor = keyPerRequest();
    const first = keyFor({ name: "Test Friend", window: "morning" });
    expect(keyFor({ name: "Test Friend", window: "morning" })).toBe(first);
    const moved = keyFor({ name: "Test Friend", window: "evening" });
    expect(moved).not.toBe(first);
    expect(keyFor({ name: "Test Friend", window: "morning" })).not.toBe(moved);
    expect(keyPerRequest()({ name: "Test Friend", window: "morning" })).not.toBe(first);
  });
});

describe("attribution", () => {
  it("keeps the campaign tags, the landing path and another site as the referrer", () => {
    const url = new URL("https://maneman.in/book?utm_source=google&utm_medium=cpc&gclid=abc&name=Arjun&x=1");
    expect(attributionFrom(url, "https://www.google.com/search?q=hair+system")).toEqual({
      landing_path: "/book",
      utm_source: "google",
      utm_medium: "cpc",
      gclid: "abc",
      referrer: "https://www.google.com/search",
    });
  });

  it("drops the site's own pages as referrers, and anything not a campaign tag", () => {
    const url = new URL("https://maneman.in/?mobile=9810000000");
    expect(attributionFrom(url, "https://maneman.in/try")).toEqual({ landing_path: "/" });
  });

  it("caps each value at the API's limits", () => {
    const url = new URL(`https://maneman.in/?utm_source=${"a".repeat(300)}`);
    expect(attributionFrom(url, "").utm_source).toHaveLength(200);
  });
});

// The confirmation opens the app with the number typed filled in.
describe("the link into the client app", () => {
  const APP = "https://app-staging.maneman.in";

  it("puts the number typed after the #, as ten digits however it was typed", () => {
    expect(signInLink(APP, "98100 00000")).toBe(`${APP}/#mobile=9810000000`);
    expect(signInLink(APP, "+91 98100-00000")).toBe(`${APP}/#mobile=9810000000`);
  });

  it("opens the plain sign-in for anything that is not a mobile number", () => {
    expect(signInLink(APP, "12345")).toBe(APP);
  });
});

// The owner's ruling of 27 September 2026: the full address before a slot is confirmed, on the site too (ADR 0081).
describe("the address a consultation is at", () => {
  it("starts in the city of the pincode checked, and asks for the flat, the building or street and the area", () => {
    expect(missingParts(emptyAddress("Gurgaon"))).toEqual(["flat", "line1", "locality"]);
    expect(missingParts(emptyAddress(null))).toEqual(["flat", "line1", "locality", "city"]);
  });

  it("counts a part filled with spaces as left out", () => {
    const typed = { ...emptyAddress("Gurgaon"), flat: " ", line1: "  ", locality: "Sector 65", city: " " };
    expect(missingParts(typed)).toEqual(["flat", "line1", "city"]);
  });

  it("is sent trimmed, in the pincode checked, with a part left blank as none", () => {
    const typed = {
      ...emptyAddress("Gurgaon"),
      flat: " Flat 402 ",
      line1: "Palm Grove Society ",
      locality: "Sector 65",
      accessNotes: "  ",
    };
    expect(addressToSend(typed, "122018")).toEqual({
      flat: "Flat 402",
      floor: null,
      tower: null,
      line1: "Palm Grove Society",
      line2: null,
      landmark: null,
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
      access_notes: null,
    });
  });
});
