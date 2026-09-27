// Changing a client's mobile number (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them. A change is asked for, proven and confirmed in src/domain/number-change.ts.

export const RULES = [
  "A code goes to both numbers.",
  "The change then waits for ops to confirm, and takes effect only after that confirmation.",
] as const;
