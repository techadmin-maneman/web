// What a referrer sees of their referrals (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rule as the prompt states it. The tracker is GET /api/refer's fitted friends (src/routes/client-refer.ts).

export const RULES = [
  "The referrer sees completed fits only: first name and month. Never opens, consultations or pending referrals.",
] as const;
