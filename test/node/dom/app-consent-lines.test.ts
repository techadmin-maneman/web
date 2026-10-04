// The pay step's lines for the photograph consents booking gives (apps/app/src/booking/consents.ts), held to the
// notices the API records them under (src/config/notices.ts; docs/decisions/0080-consents-given-by-booking.md). A
// consent row names the notice the client saw, so what the pay step shows must be that notice, word for word.

import { describe, expect, it } from "vitest";
import { consentLines } from "../../../apps/app/src/booking/consents.ts";
import { booking, profile } from "../../../apps/app/src/content.ts";
import { BOOKING_NOTICES, CURRENT_NOTICE, findNotice, REMINDER_NOTICE } from "../../../src/config/notices.ts";

const BOTH = ["photos_own_record", "photos_referral_cards"] as const;

describe("the pay step's consent lines", () => {
  it.each(BOTH)("are the notice %s is recorded under, when both are asked and when it is asked alone", (purpose) => {
    expect(consentLines(BOTH)).toEqual(findNotice(BOOKING_NOTICES.both[purpose])?.text);
    expect(consentLines([purpose])).toEqual(findNotice(BOOKING_NOTICES.alone[purpose])?.text);
  });

  it("carry the referral card's lines as the profile's notice words them, the naming line among them", () => {
    const cardLines = findNotice(CURRENT_NOTICE.photos_referral_cards)?.text.slice(1);
    expect(consentLines(["photos_referral_cards"]).slice(1, -1)).toEqual(cardLines);
    expect(consentLines(BOTH)).toContain("Your first name appears on your invite.");
  });

  it("are none when nothing is asked", () => {
    expect(consentLines([])).toEqual([]);
  });
});

describe("the app's other consent lines", () => {
  it("word the booking sheet's reminder box as the notice its yes is recorded under", () => {
    expect([booking.pay.remind]).toEqual(findNotice(REMINDER_NOTICE)?.text);
  });

  it("word the profile's switch for the photographs taken for the visit record as its notice", () => {
    expect([profile.purposes.photos_own_record]).toEqual(findNotice(CURRENT_NOTICE.photos_own_record)?.text);
  });
});
