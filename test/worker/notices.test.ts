import { describe, expect, it } from "vitest";
import {
  BOOKING_NOTICES,
  CONSULTATION_NOTICES,
  CURRENT_NOTICE,
  NAMING_NOTICES,
  NOTICES,
  REMINDER_NOTICE,
  findNotice,
  switchNotice,
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

  // ADR 0104: the look goes to WhatsApp only, so the try-on shows only notices that say so, and they still keep a
  // client's try-on (ADR 0084). No published version says it: the published v1 promised the result on screen.
  it("shows the try-on's notices that send the look to WhatsApp, which keep a client's try-on", () => {
    const photo = findNotice(CURRENT_NOTICE.tryon_photo);
    const gate = findNotice(CURRENT_NOTICE.result_delivery);
    expect([photo?.version, gate?.version]).toEqual(["photo-v3", "gate-v3"]);
    expect(photo?.text.join(" ")).toContain("sent to your WhatsApp and never shown on this site");
    expect(gate?.text.join(" ")).toContain("never shown on this site");
    expect(gate?.text.join(" ")).not.toContain("next screen");
    expect(KEEPING_NOTICES).toContain(CURRENT_NOTICE.tryon_photo);
    expect(Object.keys(PUBLISHED)).not.toContain(CURRENT_NOTICE.tryon_photo);
  });

  it("records a consent given by booking on its own purpose's notice, and names a referrer on each card notice that says so", () => {
    for (const notices of Object.values(BOOKING_NOTICES)) {
      for (const [purpose, version] of Object.entries(notices)) expect(findNotice(version)?.purpose).toBe(purpose);
    }
    // A consent given on an earlier booking notice still names its referrer.
    expect(NAMING_NOTICES).toEqual([
      CURRENT_NOTICE.photos_referral_cards,
      "photos-referral-cards-booking-v1",
      BOOKING_NOTICES.alone.photos_referral_cards,
      BOOKING_NOTICES.both.photos_referral_cards,
    ]);
  });

  it("says the photographs for the client's record are taken for their visit record, wherever it is asked", () => {
    expect(findNotice(CURRENT_NOTICE.photos_own_record)?.text).toEqual(["Photographs taken for your visit record"]);
    for (const notices of Object.values(BOOKING_NOTICES)) {
      expect(findNotice(notices.photos_own_record)?.text[0]).toContain("photographs taken for your visit record");
    }
  });

  it("records the booking sheet's reminder on its own line, and every other switch on the purpose's current notice", () => {
    expect(findNotice(REMINDER_NOTICE)).toEqual({
      version: "whatsapp-visits-booking-v1",
      purpose: "whatsapp_visits",
      text: ["Remind me on WhatsApp the day before"],
    });
    expect(switchNotice("whatsapp_visits", "app_booking")).toBe(REMINDER_NOTICE);
    expect(switchNotice("whatsapp_visits", "app_profile")).toBe(CURRENT_NOTICE.whatsapp_visits);
    expect(switchNotice("whatsapp_visits", null)).toBe(CURRENT_NOTICE.whatsapp_visits);
    expect(switchNotice("photos_referral_cards", "app_share_sheet")).toBe(CURRENT_NOTICE.photos_referral_cards);
  });

  it("names the booking form's line on /book for the site, with the words the invite's page shows", () => {
    const site = findNotice(CONSULTATION_NOTICES.site_booking);
    const landing = findNotice(CONSULTATION_NOTICES.referral_landing);
    expect(site?.version).toBe("site-consultation-v1");
    expect(landing?.version).toBe("referral-consultation-v1");
    expect(site?.purpose).toBe(landing?.purpose);
    expect(site?.text).toEqual(landing?.text);
  });

  it("carries the design's booking wording", () => {
    expect(findNotice(CURRENT_NOTICE.contact)?.text).toEqual([
      "I agree to be contacted about this visit. I have read how my details are used.",
    ]);
  });
});
