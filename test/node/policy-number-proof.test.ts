// A number proved with a WhatsApp code before a site form acts on it (src/policy/number-proof.ts).

import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "../../src/lib/durations.ts";
import { bookingNeedsProof, stillProved } from "../../src/policy/number-proof.ts";

describe("a number proved with a code", () => {
  it("asks a proved number of the site's consultation and fit in one visit", () => {
    expect(bookingNeedsProof("one_visit")).toBe(true);
  });

  it("keeps a number proved for 30 minutes after its code is entered", () => {
    const entered = new Date("2026-10-02T10:00:00.000Z");
    expect(stillProved(entered, new Date(entered.getTime() + 29 * MINUTE_MS))).toBe(true);
    expect(stillProved(entered, new Date(entered.getTime() + 30 * MINUTE_MS))).toBe(false);
  });

  it("asks no code of a consultation alone", () => {
    expect(bookingNeedsProof("consultation")).toBe(false);
  });
});
