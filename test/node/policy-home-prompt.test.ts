// Home's one prompt, in the owner's order, named by the owner's own words (src/policy/home-prompt.ts;
// docs/owner-answers-2026-09-27.md, item 46).

import { describe, expect, it } from "vitest";
import { HOME_PROMPTS, homePromptOf, RULES, type PromptFacts } from "../../src/policy/home-prompt.ts";
import { NEXT_VISIT_DAYS } from "../../src/policy/next-visit.ts";

const NONE: PromptFacts = { address: false, next_visit: false, replacement_due: false, invoice_ready: false };

describe("Home's prompt", () => {
  it(RULES[0], () => {
    expect(HOME_PROMPTS).toEqual(["address", "next_visit", "replacement_due", "invoice_ready"]);
    const all = { address: true, next_visit: true, replacement_due: true, invoice_ready: true };
    expect(homePromptOf(all)).toBe("address");
    expect(homePromptOf({ ...all, address: false })).toBe("next_visit");
    expect(homePromptOf({ ...NONE, replacement_due: true, invoice_ready: true })).toBe("replacement_due");
    expect(homePromptOf({ ...NONE, invoice_ready: true })).toBe("invoice_ready");
    // The fortnight, which ops may change.
    expect(NEXT_VISIT_DAYS.invoice_prompt).toBe(14);
  });

  it("shows nothing when nothing applies", () => {
    expect(homePromptOf(NONE)).toBeNull();
  });
});
