// When a referral grant waits for ops (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M3.

export const RULES = [
  "A grant is held for ops review when any of these is true:",
  "the referrer and the referred share an address",
  "they share a UPI handle or card fingerprint",
  "the referrer passes config REFERRAL_MONTHLY_CAP (5) fits in a calendar month",
  "the mobile numbers match",
  "Held grants appear in the review queue. Ops approve or reject each one.",
] as const;
