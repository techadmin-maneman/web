// When a referral grant waits for ops (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them, and the owner's ruling on the cap (ADR 0025, item 24). Each is checked
// in fraudSignals (src/domain/referral-grants.ts).

export const RULES = [
  "A grant is held for ops review when any of these is true:",
  "the referrer and the referred share an address",
  "they share a UPI handle or card fingerprint",
  "the referrer passes config REFERRAL_MONTHLY_CAP (5) fits in a calendar month",
  "the mobile numbers match",
  "Held grants appear in the review queue. Ops approve or reject each one.",
] as const;

/** Fits a referrer may have granted in a calendar month in India before the next is held: 5, as ruled. */
export const REFERRAL_MONTHLY_CAP = 5;

/** Each rule a grant can meet, in the order above. The card fingerprint is not given to us (ADR 0025, item 21). */
export const FRAUD_SIGNALS = ["shared_address", "shared_upi", "monthly_cap", "same_mobile"] as const;
export type FraudSignal = (typeof FRAUD_SIGNALS)[number];
