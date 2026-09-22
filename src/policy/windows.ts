// The client's three windows against the board's four slots (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them; their code arrives in P2-M4.

export const RULES = [
  "The client app offers three windows (9–12, 12–4, 4–8). The dispatch board has four slots a day. Define the mapping in config WINDOW_SLOT_MAP and record it in an ADR. The two designs do not agree, so the mapping must be explicit, not guessed.",
] as const;
