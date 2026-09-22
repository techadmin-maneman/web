// How long an invite lasts (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M3.

export const RULES = [
  "An invite to an unserved area stays valid config INVITE_TTL_AFTER_LAUNCH_DAYS (365) after that area goes live.",
  "An expired invite still allows a free consultation, but carries no credits.",
] as const;
