// Booking from the public site (src/policy/site-booking.ts).

import { describe, expect, it } from "vitest";
import { notBookedFromSite, typedAddress } from "../../src/policy/site-booking.ts";

const MAY_BOOK = { hasConsultationToCome: false, mayBookConsultation: true, addressOutsideArea: false };

describe("booking from the site", () => {
  it("saves an address typed on the site only where the person has none saved", () => {
    expect(typedAddress({ hasSavedAddress: false })).toBe("saved");
    expect(typedAddress({ hasSavedAddress: true })).toBe("on_account");
  });

  it("books nothing from the site for a number with a consultation to come or past consultations", () => {
    expect(notBookedFromSite(MAY_BOOK)).toBeNull();
    expect(notBookedFromSite({ ...MAY_BOOK, hasConsultationToCome: true, mayBookConsultation: false })).toBe(
      "consultation_exists",
    );
    expect(notBookedFromSite({ ...MAY_BOOK, mayBookConsultation: false })).toBe("book_in_app");
  });

  it("books nothing where the account's address is outside the area, and names a consultation to come first", () => {
    expect(notBookedFromSite({ ...MAY_BOOK, addressOutsideArea: true })).toBe("address_not_served");
    // A consultation still to come is the first thing its owner is told of.
    expect(notBookedFromSite({ ...MAY_BOOK, hasConsultationToCome: true, addressOutsideArea: true })).toBe(
      "consultation_exists",
    );
  });
});
