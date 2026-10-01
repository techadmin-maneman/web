// What a referral earns, as GET /api/referral-reward answers it (docs/decisions/0107-referral-rewards-in-the-console.md),
// shared by the mm-site Worker, which writes it onto <body>, and the landing's island, which reads it back or asks for
// it where the Worker did not. Neither trusts an answer it cannot read: one that fails the check is treated as no
// answer, and the page then gives no count.

import type { ReferralReward } from "./api.ts";

const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;

export function isReferralReward(value: unknown): value is ReferralReward {
  if (typeof value !== "object" || value === null) return false;
  const { referrer_visits: referrer, friend_visits: friend, valid_days: days } = value as Record<string, unknown>;
  return isCount(referrer) && isCount(friend) && isCount(days);
}
