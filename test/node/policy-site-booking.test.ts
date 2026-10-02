// Booking from the public site, each rule named by its own words (src/policy/site-booking.ts).

import { describe, expect, it } from "vitest";
import { notBookedFromSite, RULES, typedAddress } from "../../src/policy/site-booking.ts";

describe("booking from the site", () => {
  it(RULES[0], () => {
    expect(typedAddress({ hasSavedAddress: false })).toBe("saved");
    expect(typedAddress({ hasSavedAddress: true })).toBe("on_account");
  });

  it(RULES[1], () => {
    expect(notBookedFromSite({ hasConsultationToCome: false, mayBookConsultation: true })).toBeNull();
    expect(notBookedFromSite({ hasConsultationToCome: true, mayBookConsultation: false })).toBe(
      "consultation_exists",
    );
    expect(notBookedFromSite({ hasConsultationToCome: false, mayBookConsultation: false })).toBe("book_in_app");
  });
});
