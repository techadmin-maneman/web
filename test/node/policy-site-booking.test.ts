// Booking from the public site, each rule named by its own words (src/policy/site-booking.ts).

import { describe, expect, it } from "vitest";
import { notBookedFromSite, RULES, typedAddress } from "../../src/policy/site-booking.ts";

const MAY_BOOK = { hasConsultationToCome: false, mayBookConsultation: true, addressOutsideArea: false };

describe("booking from the site", () => {
  it(RULES[0], () => {
    expect(typedAddress({ hasSavedAddress: false })).toBe("saved");
    expect(typedAddress({ hasSavedAddress: true })).toBe("on_account");
  });

  it(RULES[1], () => {
    expect(notBookedFromSite(MAY_BOOK)).toBeNull();
    expect(notBookedFromSite({ ...MAY_BOOK, hasConsultationToCome: true, mayBookConsultation: false })).toBe(
      "consultation_exists",
    );
    expect(notBookedFromSite({ ...MAY_BOOK, mayBookConsultation: false })).toBe("book_in_app");
  });

  it(RULES[2], () => {
    expect(notBookedFromSite({ ...MAY_BOOK, addressOutsideArea: true })).toBe("address_not_served");
    // A consultation still to come is the first thing its owner is told of.
    expect(notBookedFromSite({ ...MAY_BOOK, hasConsultationToCome: true, addressOutsideArea: true })).toBe(
      "consultation_exists",
    );
  });
});
