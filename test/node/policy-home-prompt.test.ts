// Home's one prompt, in the owner's order, named by the owner's own words (src/policy/home-prompt.ts). An invoice
// just issued is not among them: it is a second line beneath, whatever the prompt (MON-20).

import { describe, expect, it } from "vitest";
import { HOME_PROMPTS, homePromptOf, RULES, type PromptFacts } from "../../src/policy/home-prompt.ts";
import { NEXT_VISIT_DAYS } from "../../src/policy/next-visit.ts";

const NONE: PromptFacts = { address: false, next_visit: false, replacement_due: false };

describe("Home's prompt", () => {
  it(RULES[0], () => {
    expect(HOME_PROMPTS).toEqual(["address", "next_visit", "replacement_due"]);
    const all = { address: true, next_visit: true, replacement_due: true };
    expect(homePromptOf(all)).toBe("address");
    expect(homePromptOf({ ...all, address: false })).toBe("next_visit");
    expect(homePromptOf({ ...NONE, replacement_due: true })).toBe("replacement_due");
  });

  it(RULES[1], () => {
    expect(HOME_PROMPTS).not.toContain("invoice_ready");
    // The fortnight, which ops may change.
    expect(NEXT_VISIT_DAYS.invoice_prompt).toBe(14);
  });

  it("shows nothing when nothing applies", () => {
    expect(homePromptOf(NONE)).toBeNull();
  });
});
