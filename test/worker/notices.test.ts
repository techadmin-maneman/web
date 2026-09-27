import { describe, expect, it } from "vitest";
import {
  BOOKING_NOTICES,
  CURRENT_NOTICE,
  NAMING_NOTICES,
  NOTICES,
  TRY_ON_NOTICES_AWAITING_COUNSEL,
  findNotice,
} from "../../src/config/notices.ts";
import { sha256Hex } from "../../src/lib/hash.ts";
import { KEEPING_NOTICES } from "../../src/policy/kept-try-ons.ts";

/**
 * A consent row names the notice version the person saw, so a published text
 * must never change. To change wording, add a new version; never edit these.
 */
const PUBLISHED: Readonly<Record<string, string>> = {
  "booking-v1": "bab5f35d9d89e47079ccfbb4870c09083d4f3ea8916dd89fec644381bfb9eb45",
  "photo-v1": "d56c9dbe62b567e03e09036a14c5654d5345be17ec00bf78adc54a34758cb631",
  "gate-v1": "4f07c8a8313d5a1b58d2a9f98471078c9040f90a321606c5082ad5a723d25f5c",
};

describe("consent notices", () => {
  it.each(Object.entries(PUBLISHED))("%s is unchanged since it was published", async (version, hash) => {
    const notice = findNotice(version);
    expect(notice).toBeDefined();
    expect(await sha256Hex(JSON.stringify(notice?.text))).toBe(hash);
  });

  it("has unique versions, and a current version for every purpose that exists", () => {
    const versions = NOTICES.map((notice) => notice.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const [purpose, version] of Object.entries(CURRENT_NOTICE)) {
      expect(findNotice(version)?.purpose).toBe(purpose);
    }
  });

  // ADR 0084: only a photo notice that says so keeps a client's try-on, and production shows the published one.
  it("holds the try-on's pair awaiting counsel, whose photo notice alone of the two keeps a client's try-on", () => {
    expect(findNotice(TRY_ON_NOTICES_AWAITING_COUNSEL.photo)?.purpose).toBe("tryon_photo");
    expect(findNotice(TRY_ON_NOTICES_AWAITING_COUNSEL.gate)?.purpose).toBe("result_delivery");
    expect(KEEPING_NOTICES).toEqual([TRY_ON_NOTICES_AWAITING_COUNSEL.photo]);
    expect(KEEPING_NOTICES).not.toContain(CURRENT_NOTICE.tryon_photo);
  });

  it("records a consent given by booking on its own purpose's notice, and names a referrer on each card notice that says so", () => {
    for (const notices of Object.values(BOOKING_NOTICES)) {
      for (const [purpose, version] of Object.entries(notices)) expect(findNotice(version)?.purpose).toBe(purpose);
    }
    expect(NAMING_NOTICES).toEqual([
      CURRENT_NOTICE.photos_referral_cards,
      BOOKING_NOTICES.both.photos_referral_cards,
      BOOKING_NOTICES.alone.photos_referral_cards,
    ]);
  });

  it("carries the design's booking wording", () => {
    expect(findNotice(CURRENT_NOTICE.contact)?.text).toEqual([
      "I agree to be contacted about this visit. I have read how my details are used.",
    ]);
  });
});
