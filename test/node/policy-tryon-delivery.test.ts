// The try-on's look goes to WhatsApp only (src/policy/tryon-delivery.ts): a try-on whose look could not be sent
// does not run.

import { describe, expect, it } from "vitest";
import { RULING, undelivered } from "../../src/policy/tryon-delivery.ts";

const SENDS = { messagingOn: true, heldBack: false, capSpent: false };

describe("the try-on's look, on WhatsApp only", () => {
  describe(RULING, () => {
    it("runs when the look would be sent", () => {
      expect(undelivered(SENDS)).toBeNull();
    });

    it("does not run while WhatsApp is off, whatever else holds", () => {
      expect(undelivered({ ...SENDS, messagingOn: false })).toBe("whatsapp_off");
      expect(undelivered({ messagingOn: false, heldBack: true, capSpent: true })).toBe("whatsapp_off");
    });

    it("does not run for a number staging's allowlist would hold back", () => {
      expect(undelivered({ ...SENDS, heldBack: true })).toBe("held_back");
    });

    it("does not run for a number that has had its looks today", () => {
      expect(undelivered({ ...SENDS, capSpent: true })).toBe("number_capped");
    });
  });
});
