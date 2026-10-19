// The app's consent lines held to the notices the API records them under (src/config/notices.ts): a consent row names
// the notice the client saw, so what a screen shows must be that notice, word for word. Booking agrees to no
// photograph consent (apps/app/src/booking/consents.ts): the pay step says what every visit's photographs are.

import { describe, expect, it } from "vitest";
import { photoLine } from "../../../apps/app/src/booking/consents.ts";
import { booking, profile } from "../../../apps/app/src/content.ts";
import { CURRENT_NOTICE, findNotice, REMINDER_NOTICE } from "../../../src/config/notices.ts";

describe("the pay step’s photograph lines", () => {
  it("say what every visit’s photographs are, as Profile does, and agree to no referral card", () => {
    expect(photoLine()).toBe(profile.visitPhotos);
    expect(photoLine()).not.toMatch(/referral|card/i);
  });
});

describe("the app’s other consent lines", () => {
  it("word the booking sheet’s reminder box as the notice its yes is recorded under", () => {
    expect(booking.pay.remind).toBe(findNotice(REMINDER_NOTICE)?.line?.says);
  });

  // The card's five lines before a client turned it on are one, linking to the rest of the notice (ADR 0219).
  it("word the referral card's one line as its current notice, which names the referrer", () => {
    expect(profile.referralCards.line).toBe(findNotice(CURRENT_NOTICE.photos_referral_cards)?.line?.says);
  });
});
