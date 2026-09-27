// Booking a visit in the app, each rule named by the owner's own words of 27 September 2026 (src/policy/booking.ts).

import { describe, expect, it } from "vitest";
import { agreedByBooking, isFullAddress, RULES } from "../../src/policy/booking.ts";

const ADDRESS = { line1: "House 4417, Tower C", locality: "Sector 65", city: "Gurgaon", pincode: "122018" };

describe("booking in the app", () => {
  it(RULES[0], () => {
    expect(isFullAddress(ADDRESS)).toBe(true);
    expect(isFullAddress(null)).toBe(false);
    expect(isFullAddress({ ...ADDRESS, line1: " " })).toBe(false);
    expect(isFullAddress({ ...ADDRESS, locality: "" })).toBe(false);
    expect(isFullAddress({ ...ADDRESS, city: "" })).toBe(false);
    expect(isFullAddress({ ...ADDRESS, pincode: "1220" })).toBe(false);
  });

  it(RULES[1], () => {
    const both = ["photos_own_record", "photos_referral_cards"] as const;
    expect(agreedByBooking(both, [])).toEqual(both);
    expect(agreedByBooking(["photos_referral_cards"], [])).toEqual(["photos_referral_cards"]);
    expect(agreedByBooking([], [])).toEqual([]);
  });

  it("never switches back on a purpose the client has decided on, either way", () => {
    const both = ["photos_own_record", "photos_referral_cards"] as const;
    expect(agreedByBooking(both, ["photos_referral_cards"])).toEqual(["photos_own_record"]);
    expect(agreedByBooking(both, both)).toEqual([]);
  });

  it("agrees to no purpose but the two photograph ones, whatever is sent", () => {
    expect(agreedByBooking(["photos_marketing", "whatsapp_visits", "whatsapp_launches"], [])).toEqual([]);
  });
});
