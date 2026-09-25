// What a referral earns (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them. The grant is src/domain/referral-grants.ts and the ledger
// src/domain/credits.ts (docs/decisions/0048-referrals.md).

import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";

export const RULES = [
  "When a referred person's first fit closes as done, the referrer and the referred each get 3 service-visit credits.",
  "There is no other discount for the referred person.",
  "Credits are usable on any day.",
  "Credits expire config CREDIT_TTL_DAYS after grant (365 by default; the design shows an expiry date of 3 Jan 2028).",
] as const;

/** Service-visit credits each side gets when the referred person's first fit closes as done. */
export const CREDITS_PER_REFERRAL = 3;

/** How long a credit lasts from its grant: the default, which the owner kept (ADR 0025, item 24). */
export const CREDIT_TTL_DAYS = 365;

/**
 * When a credit granted at `grantedAt` expires: at the end of the day in India that falls CREDIT_TTL_DAYS
 * later, the date the client is shown, so it can still be booked with all of that day.
 */
export function creditExpiry(grantedAt: Date): Date {
  const lastDay = indiaDate(new Date(grantedAt.getTime() + CREDIT_TTL_DAYS * 86_400_000));
  return new Date(indiaInstant(addDays(lastDay, 1), "00:00").getTime() - 1);
}
