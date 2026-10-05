// What a referral earns, each rule named by the prompt's own words, or the owner's (src/policy/referral-reward.ts).

import { describe, expect, it } from "vitest";
import { checkValue, settingNamed } from "../../../src/policy/ops-settings.ts";
import { COMMITTED } from "../../../src/domain/ops-settings.ts";
import { indiaDate } from "../../../src/lib/india-time.ts";
import {
  CREDIT_TTL_DAYS,
  creditExpiry,
  REFERRAL_REWARD,
  RULES,
  takesCredit,
} from "../../../src/policy/referral-reward.ts";

describe("referral credits", () => {
  it(`${RULES[0]} ${RULES[1]}`, () => {
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

  it(RULES[2], () => {
    expect(CREDIT_TTL_DAYS).toBe(365);
    // Granted at 11:30 pm in India on 21 September 2026: good for all of 21 September 2027 in India.
    const granted = new Date("2026-09-21T18:00:00Z");
    const expires = creditExpiry(granted);
    expect(expires.toISOString()).toBe("2027-09-21T18:29:59.999Z");
    expect(indiaDate(expires)).toBe("2027-09-21");
    // Granted at 9 am: the same day, not 9 am of it.
    expect(creditExpiry(new Date("2026-09-21T03:30:00Z")).toISOString()).toBe("2027-09-21T18:29:59.999Z");
  });

  it(RULES[3], () => {
    // Until ops set them, each side gets the prompt's 3 and the credits last its 365 days.
    expect(REFERRAL_REWARD).toEqual({ referrer_visits: 3, friend_visits: 3, valid_days: 365 });
    expect(COMMITTED.referralReward).toEqual(REFERRAL_REWARD);
    // Each side apart, and either may be given nothing.
    const setting = settingNamed("referral_reward");
    if (setting === undefined) throw new Error("referral_reward is not in the register");
    expect(checkValue(setting, { referrer_visits: 3, friend_visits: 0, valid_days: 365 })).toMatchObject({ ok: true });
    expect(checkValue(setting, { referrer_visits: 0, friend_visits: 2, valid_days: 90 })).toMatchObject({ ok: true });
    // A sane maximum of visits, and a life no shorter than a month or longer than three years.
    for (const refused of [
      { referrer_visits: 13, friend_visits: 3, valid_days: 365 },
      { referrer_visits: 3, friend_visits: -1, valid_days: 365 },
      { referrer_visits: 3, friend_visits: 3, valid_days: 29 },
      { referrer_visits: 3, friend_visits: 3, valid_days: 1096 },
      { referrer_visits: 3, friend_visits: 1.5, valid_days: 365 },
    ]) {
      expect(checkValue(setting, refused), JSON.stringify(refused)).toMatchObject({ ok: false });
    }
    // The credits last as long as ops set, to the end of that day in India.
    expect(creditExpiry(new Date("2026-09-21T18:00:00Z"), 30).toISOString()).toBe("2026-10-21T18:29:59.999Z");
  });
});
