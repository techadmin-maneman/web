// The app's consent lines held to the notices the API records them under (src/config/notices.ts): a consent row names
// the notice the client saw, so what a screen shows must be that notice, word for word. Booking agrees to no
// photograph consent (apps/app/src/booking/consents.ts): the pay step says what every visit's photographs are.

import { describe, expect, it } from "vitest";
import { photoLines } from "../../../apps/app/src/booking/consents.ts";
import { booking, profile } from "../../../apps/app/src/content.ts";
import { findNotice, REMINDER_NOTICE } from "../../../src/config/notices.ts";

describe("the pay step's photograph lines", () => {
  it("say what every visit's photographs are, as Profile does, and agree to no referral card", () => {
    expect(photoLines()).toEqual([profile.visitPhotos]);
    expect(photoLines().join(" ")).not.toMatch(/referral|card/i);
  });
});

describe("the app's other consent lines", () => {
  it("word the booking sheet's reminder box as the notice its yes is recorded under", () => {
    expect([booking.pay.remind]).toEqual(findNotice(REMINDER_NOTICE)?.text);
  });
});
