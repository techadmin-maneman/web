// Where a consent was given (src/policy/consents.ts)
// (docs/decisions/0094-where-a-consent-was-given.md).

import { describe, expect, it } from "vitest";
import {
  APP_SWITCH_SOURCES,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  isStopReply,
  screenAsks,
} from "../../../src/policy/consents.ts";

describe("where a consent was given", () => {
  it("records where a consent was given: the site, a booking, the profile or the technician", () => {
    expect(CONSENT_SOURCES).toEqual(
      expect.arrayContaining(["site_booking", "app_booking", "app_profile", "technician"]),
    );
  });

  it("has no place for ops to give one; the erasure only withdraws", () => {
    expect(CONSENT_SOURCES.filter((source) => source.startsWith("ops"))).toEqual([]);
    expect(CONSENT_SOURCES).toContain("erasure");
  });

  it("lets the client app name only its own screens", () => {
    expect(APP_SWITCH_SOURCES).toEqual(["app_profile", "app_booking", "app_share_sheet"]);
  });

  it("records a screen only against a purpose that screen asks for", () => {
    const askedOn = (screen: (typeof APP_SWITCH_SOURCES)[number]) =>
      CONSENT_PURPOSES.filter((purpose) => screenAsks(screen, purpose));
    expect(askedOn("app_profile")).toEqual(CONSENT_PURPOSES);
    expect(askedOn("app_booking")).toEqual(["whatsapp_visits"]);
    expect(askedOn("app_share_sheet")).toEqual(["photos_referral_cards"]);
  });
});

// A person who replied "stop" kept getting messages.
describe("a WhatsApp reply that asks us to stop", () => {
  it.each(["STOP", "stop", "Stop.", " STOP! ", "stop all", "Unsubscribe"])("is %j", (text) => {
    expect(isStopReply(text)).toBe(true);
  });

  it.each(["Please stop by at 5", "Don't stop", "stopped", "", "OK"])("is not %j", (text) => {
    expect(isStopReply(text)).toBe(false);
  });
});
