// What a referrer sees of their referrals (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M3.

export const RULES = [
  "The referrer sees completed fits only: first name and month. Never opens, consultations or pending referrals.",
] as const;
