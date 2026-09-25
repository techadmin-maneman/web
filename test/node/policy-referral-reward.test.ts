// What a referral earns, each rule named by the prompt's own words (src/policy/referral-reward.ts).

import { describe, expect, it } from "vitest";
import { indiaDate } from "../../src/lib/india-time.ts";
import { CREDIT_TTL_DAYS, creditExpiry, RULES } from "../../src/policy/referral-reward.ts";

describe("referral credits", () => {
  it(RULES[3], () => {
    expect(CREDIT_TTL_DAYS).toBe(365);
    // Granted at 11:30 pm in India on 21 September 2026: good for all of 21 September 2027 in India.
    const granted = new Date("2026-09-21T18:00:00Z");
    const expires = creditExpiry(granted);
    expect(expires.toISOString()).toBe("2027-09-21T18:29:59.999Z");
    expect(indiaDate(expires)).toBe("2027-09-21");
    // Granted at 9 am: the same day, not 9 am of it.
    expect(creditExpiry(new Date("2026-09-21T03:30:00Z")).toISOString()).toBe("2027-09-21T18:29:59.999Z");
  });
});
