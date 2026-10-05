// Why ops decided what they did (src/policy/decision-reasons.ts). The routes refuse a decision without the reason it
// needs; test/worker checks each one.

import { describe, expect, it } from "vitest";
import { needsReason } from "../../src/policy/decision-reasons.ts";

describe("decision reasons", () => {
  it("asks a reason of a referral grant approved or rejected", () => {
    expect(needsReason("referral", "approve")).toBe(true);
    expect(needsReason("referral", "reject")).toBe(true);
  });

  it("asks a reason of a no-show charged or waived", () => {
    expect(needsReason("no_show", "charged")).toBe(true);
    expect(needsReason("no_show", "waived")).toBe(true);
  });

  it("asks a reason of either ruling on a disputed charge", () => {
    expect(needsReason("no_show_dispute", "refunded")).toBe(true);
    expect(needsReason("no_show_dispute", "upheld")).toBe(true);
  });

  // Confirming a number change or erasing an account does what the client asked, so only a refusal needs its why.
  it("asks a reason of a refusal on the client's own requests, and not of doing what they asked", () => {
    expect(needsReason("number_change", "reject")).toBe(true);
    expect(needsReason("number_change", "confirm")).toBe(false);
    expect(needsReason("deletion", "reject")).toBe(true);
    expect(needsReason("deletion", "delete")).toBe(false);
  });
});
