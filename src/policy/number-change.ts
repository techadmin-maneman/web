// Changing a client's mobile number (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M1.

export const RULES = [
  "A code goes to both numbers.",
  "The change then waits for ops to confirm, and takes effect only after that confirmation.",
] as const;
