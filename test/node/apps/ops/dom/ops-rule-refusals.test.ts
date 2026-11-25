// A rule's refusal in the console's words (apps/ops/src/settings/rule-drafts.ts): one held against another rule says
// so in a sentence of its own (docs/decisions/0319-rules-that-hold-together.md); one within its own rule names its
// two boxes.

import { describe, expect, it } from "vitest";
import type { OpsSetting } from "../../../../../apps/ops/src/api.ts";
import { settings } from "../../../../../apps/ops/src/content/settings.ts";
import { keyLabel, ruleRefusal } from "../../../../../apps/ops/src/settings/rule-drafts.ts";

const ruleNamed = (name: string, title: string) =>
  ({ name, title, kind: "number", unit: "hours", min: 0, max: 100, keys: null }) as unknown as OpsSetting;

describe("a rule refused against another", () => {
  it("says what the two rules must keep to, in a sentence of its own", () => {
    const booking = ruleNamed("booking_rules", "Booking rules");
    expect(ruleRefusal(booking, "figures_conflict", ["booking_rules.break_to", "working_hours.closes"])).toBe(
      settings.rules.crossConflicts["booking_rules|working_hours"],
    );
  });

  it("names a rule's own two boxes where they do not hold together", () => {
    const booking = ruleNamed("booking_rules", "Booking rules");
    const words = ruleRefusal(booking, "figures_conflict", ["booking_rules.break_to", "booking_rules.break_from"]);
    expect(words).toBe(settings.rules.figures_conflict(keyLabel(booking, "break_to"), keyLabel(booking, "break_from")));
  });
});
