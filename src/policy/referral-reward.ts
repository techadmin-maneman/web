// What a referral earns (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M3.

export const RULES = [
  "When a referred person's first fit closes as done, the referrer and the referred each get 3 service-visit credits.",
  "There is no other discount for the referred person.",
  "Credits are usable on any day.",
  "Credits expire config CREDIT_TTL_DAYS after grant (365 by default; the design shows an expiry date of 3 Jan 2028).",
] as const;

/** Service-visit credits each side gets when the referred person's first fit closes as done. */
export const CREDITS_PER_REFERRAL = 3;
