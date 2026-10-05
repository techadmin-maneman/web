// What a referral earns (docs/prompts/phase2-backend.md, "Business rules, decided"), and the owner's ruling of
// 1 October 2026 that ops set it in the console, each side apart (docs/decisions/0107-referral-rewards-in-the-console.md).
// The grant is src/domain/referral-grants.ts and the ledger src/domain/credits.ts (docs/decisions/0048-referrals.md).

import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";
import { DAY_MS } from "../lib/durations.ts";

// The prompt's "There is no other discount for the referred person" was retired by the owner on 1 October 2026:
// discount codes are for anyone, an invited friend too, and credits still pay first (docs/decisions/0108-discount-codes.md).
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
