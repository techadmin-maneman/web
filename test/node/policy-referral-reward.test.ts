// What a referral earns, each rule named by the prompt's own words (src/policy/referral-reward.ts).

import { describe, expect, it } from "vitest";
import { indiaDate } from "../../src/lib/india-time.ts";
import { CREDIT_TTL_DAYS, creditExpiry, RULES, takesCredit } from "../../src/policy/referral-reward.ts";

describe("referral credits", () => {
  it(`${RULES[0]} ${RULES[2]}`, () => {
    // A service visit, new or booked in place of one moved inside 24 hours, is paid with a credit.
    expect(takesCredit("service", null)).toBe(true);
    expect(takesCredit("service", "replace")).toBe(true);
    // A visit moved in place keeps the payment, or the credit, it was booked with.
    expect(takesCredit("service", "move")).toBe(false);
    // The credits are service visits: nothing else is paid with one.
    for (const type of ["consultation", "first_fit", "replacement"] as const) {
      expect(takesCredit(type, null)).toBe(false);
    }
  });

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
