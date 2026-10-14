// The try-on's look goes to WhatsApp only (src/policy/tryon-delivery.ts): a try-on whose look could not be sent
// does not run.

import { describe, expect, it } from "vitest";
import { tryOnRuns, undelivered } from "../../../src/policy/tryon-delivery.ts";

const ON = { enabled: true };
const OFF = { enabled: false };
const SENDS = { messaging: ON, bridgeDown: false, heldBack: false, capSpent: false };

describe("the try-on's look, on WhatsApp only", () => {
  describe("the look, sent on WhatsApp and never shown on the site", () => {
    it("runs only while WhatsApp can send its look", () => {
      expect(tryOnRuns(ON, false)).toBe(true);
      expect(tryOnRuns(OFF, false)).toBe(false);
      // The bridge down: no look made now would reach anyone.
      expect(tryOnRuns(ON, true)).toBe(false);
    });

    it("sends the look for a number when nothing holds it back", () => {
      expect(undelivered(SENDS)).toBeNull();
    });

    it("sends none while WhatsApp is off, whatever else holds", () => {
      expect(undelivered({ ...SENDS, messaging: OFF })).toBe("whatsapp_off");
      expect(undelivered({ messaging: OFF, bridgeDown: false, heldBack: true, capSpent: true })).toBe("whatsapp_off");
      expect(undelivered({ ...SENDS, bridgeDown: true })).toBe("whatsapp_off");
    });

    it("sends none to a number staging's allowlist would hold back", () => {
      expect(undelivered({ ...SENDS, heldBack: true })).toBe("held_back");
    });

    it("sends none to a number that has had its looks today", () => {
      expect(undelivered({ ...SENDS, capSpent: true })).toBe("number_capped");
    });
  });
});
