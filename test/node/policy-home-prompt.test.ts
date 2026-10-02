// Home's prompts in the owner's order, each rule named by the owner's own words (src/policy/home-prompt.ts).

import { describe, expect, it } from "vitest";
import { HOME_PROMPTS, homePromptOf, RULES, type PromptFacts } from "../../src/policy/home-prompt.ts";
import { NEXT_VISIT_DAYS } from "../../src/policy/next-visit.ts";

const NONE: PromptFacts = { address: false, next_visit: false, invoice_ready: false, replacement_due: false };
const ALL: PromptFacts = { address: true, next_visit: true, invoice_ready: true, replacement_due: true };

describe("Home's prompt", () => {
  it(RULES[0], () => {
    expect(HOME_PROMPTS).toEqual(["address", "next_visit", "invoice_ready", "replacement_due"]);
    expect(homePromptOf({ ...ALL, address: false })).toBe("next_visit");
    // The invoice leads only where no visit is offered, and the replacement waits for it.
    expect(homePromptOf({ ...NONE, invoice_ready: true, replacement_due: true })).toBe("invoice_ready");
    expect(homePromptOf({ ...NONE, replacement_due: true })).toBe("replacement_due");
    // The fortnight, which ops may change.
    expect(NEXT_VISIT_DAYS.invoice_prompt).toBe(14);
  });

  it(RULES[1], () => {
    expect(homePromptOf(ALL)).toBe("address");
  });

  it("shows nothing when nothing applies", () => {
    expect(homePromptOf(NONE)).toBeNull();
  });
});
