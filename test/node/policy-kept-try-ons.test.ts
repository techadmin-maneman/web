// A client's try-on, kept (src/policy/kept-try-ons.ts): which of a person's try-ons is kept once they book a visit.

import { describe, expect, it } from "vitest";
import { keptTryOn, RULES, type HeldTryOn } from "../../src/policy/kept-try-ons.ts";

const NOW = "2026-09-27T10:00:00.000Z";
const LATER = "2026-10-05T10:00:00.000Z";
const EARLIER = "2026-09-20T10:00:00.000Z";

function tryOn(id: string, columns: Partial<HeldTryOn> = {}): HeldTryOn {
  return {
    id,
    createdAt: "2026-09-26T10:00:00.000Z",
    photoConsentVersion: "photo-v2",
    keptAt: null,
    lookHeldUntil: LATER,
    ...columns,
  };
}

describe("a client's try-on, kept", () => {
  describe(RULES[0], () => {
    it("keeps nothing of someone who has not booked a visit", () => {
      expect(keptTryOn([tryOn("a")], false, NOW)).toBeNull();
    });

    it("keeps a client's try-on while its look is still held, and one only: the oldest", () => {
      const tryOns = [
        tryOn("newer", { createdAt: "2026-09-26T12:00:00.000Z" }),
        tryOn("older", { createdAt: "2026-09-25T12:00:00.000Z" }),
      ];
      expect(keptTryOn(tryOns, true, NOW)).toBe("older");
    });

    it("keeps none whose look was gone before they booked", () => {
      expect(
        keptTryOn([tryOn("gone", { lookHeldUntil: EARLIER }), tryOn("none", { lookHeldUntil: null })], true, NOW),
      ).toBeNull();
    });

    it("keeps a look on the day it would go, which the sweeper decides at", () => {
      expect(keptTryOn([tryOn("due", { lookHeldUntil: NOW })], true, NOW)).toBe("due");
    });

    // The published notices promise deletion within thirty days (ADR 0084).
    it("never keeps one whose photograph was agreed to under a notice that does not say so", () => {
      expect(keptTryOn([tryOn("v1", { photoConsentVersion: "photo-v1" })], true, NOW)).toBeNull();
    });

    it("keeps the one already kept, whatever the client makes after it", () => {
      const tryOns = [
        tryOn("kept", { keptAt: EARLIER, lookHeldUntil: null, createdAt: "2026-09-01T10:00:00.000Z" }),
        tryOn("new", { createdAt: "2026-09-26T12:00:00.000Z" }),
      ];
      expect(keptTryOn(tryOns, true, NOW)).toBe("kept");
    });
  });
});
