// Paying for a visit (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M5.

export const RULES = [
  "Every visit is prepaid at booking. Technicians never handle money, and no amount to collect is ever sent to FSM.",
] as const;
