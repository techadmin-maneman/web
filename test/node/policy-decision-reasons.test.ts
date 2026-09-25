// Why ops decided what they did, each rule named by the prompts' own words
// (src/policy/decision-reasons.ts). The routes refuse a decision without the
// reason it needs; test/worker checks each one.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSOLE_RULES, needsReason, RULES } from "../../src/policy/decision-reasons.ts";

const FRONTEND = readFileSync("docs/prompts/phase2-frontend.md", "utf8").replace(/\s+/g, " ");

describe("decision reasons", () => {
  it(RULES[0], () => {
    expect(needsReason("referral", "approve")).toBe(true);
    expect(needsReason("referral", "reject")).toBe(true);
  });

  it.each(CONSOLE_RULES)("quotes the frontend prompt word for word: %s", (rule) => {
    expect(FRONTEND.includes(rule)).toBe(true);
  });

  it(CONSOLE_RULES[0], () => {
    expect(needsReason("no_show", "charged")).toBe(true);
    expect(needsReason("no_show", "waived")).toBe(true);
  });

  // Confirming a number change or erasing an account does what the client asked, so only a refusal needs its why.
  it("asks a reason of a refusal on the client's own requests, and not of doing what they asked", () => {
    expect(needsReason("number_change", "reject")).toBe(true);
    expect(needsReason("number_change", "confirm")).toBe(false);
    expect(needsReason("deletion", "reject")).toBe(true);
    expect(needsReason("deletion", "delete")).toBe(false);
  });
});
