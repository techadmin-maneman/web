// What deleting an account deletes, and when (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M1.

export const RULES = [
  "Photographs deleted within 7 days (config); invoices kept 8 years (config). Both need counsel's sign-off before launch, and the design flags this.",
] as const;
