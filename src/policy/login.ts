// Who may log in to the client app (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rule as the prompt states it. Who it lets in is findEligiblePerson in src/domain/login.ts.

export const RULES = ["Open to any person with a booked consultation or any later appointment. No password."] as const;
