// A number proved with a WhatsApp code before a site form acts on it, each rule named by its own words
// (src/policy/number-proof.ts).

import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "../../src/lib/durations.ts";
import { bookingNeedsProof, RULES, stillProved } from "../../src/policy/number-proof.ts";

describe("a number proved with a code", () => {
  it(RULES[0], () => {
    expect(bookingNeedsProof("one_visit")).toBe(true);
  });

  it(RULES[1], () => {
    const entered = new Date("2026-10-02T10:00:00.000Z");
    expect(stillProved(entered, new Date(entered.getTime() + 29 * MINUTE_MS))).toBe(true);
    expect(stillProved(entered, new Date(entered.getTime() + 30 * MINUTE_MS))).toBe(false);
  });

  it(RULES[2], () => {
    expect(bookingNeedsProof("consultation")).toBe(false);
  });
});
