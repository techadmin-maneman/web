// What a referral earns (docs/prompts/phase2-backend.md, "Business rules, decided"), and the owner's ruling of
// 1 October 2026 that ops set it in the console, each side apart (docs/decisions/0107-referral-rewards-in-the-console.md).
// The grant is src/domain/referral-grants.ts and the ledger src/domain/credits.ts (docs/decisions/0048-referrals.md).

import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";
import { DAY_MS } from "../lib/durations.ts";

export const RULES = [
  "When a referred person's first fit closes as done, the referrer and the referred each get 3 service-visit credits.",
  "There is no other discount for the referred person.",
  "Credits are usable on any day.",
  "Credits expire config CREDIT_TTL_DAYS after grant (365 by default; the design shows an expiry date of 3 Jan 2028).",
  // The owner's ruling of 1 October 2026 (ADR 0025, item 94). It amends the first and the fourth: their 3 and their
  // 365 are each side's visits and the credits' life until ops set others.
  "Ops set, in the console, the referrer's free service visits and the referred friend's free service visits separately, and how long the credits last.",
] as const;

/** Service-visit credits each side gets to begin with, when the referred person's first fit closes as done. */
export const CREDITS_PER_REFERRAL = 3;

/** How long a credit lasts from its grant to begin with: the default, which the owner kept (ADR 0025, item 24). */
export const CREDIT_TTL_DAYS = 365;

export const REFERRAL_REWARD_KEYS = ["referrer_visits", "friend_visits", "valid_days"] as const;

/** What a referral earns, as ops set it: each side's service visits, either of which may be 0, and their life in days. */
export type ReferralReward = Readonly<Record<(typeof REFERRAL_REWARD_KEYS)[number], number>>;

export const REFERRAL_REWARD: ReferralReward = {
  referrer_visits: CREDITS_PER_REFERRAL,
  friend_visits: CREDITS_PER_REFERRAL,
  valid_days: CREDIT_TTL_DAYS,
};

/** The most service visits ops may give either side: a year of monthly visits. */
export const MAX_REWARD_VISITS = 12;

/**
 * Whether a booking is one a credit pays for, when the client holds one: a service visit, new or booked in place
 * of a visit moved inside 24 hours. A visit moved in place keeps the payment, or the credit, it was booked with
 * (src/policy/moving-a-visit.ts).
 */
export const takesCredit = (type: VisitType, moveKind: "move" | "replace" | null): boolean =>
  type === "service" && moveKind !== "move";

/**
 * When a credit granted at `grantedAt` expires: at the end of the day in India that falls `validDays` later, the
 * date the client is shown, so it can still be booked with all of that day.
 */
export function creditExpiry(grantedAt: Date, validDays: number = CREDIT_TTL_DAYS): Date {
  const lastDay = indiaDate(new Date(grantedAt.getTime() + validDays * DAY_MS));
  return new Date(indiaInstant(addDays(lastDay, 1), "00:00").getTime() - 1);
}
