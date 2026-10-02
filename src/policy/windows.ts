// The client's three windows against the board's four slots (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rule as the prompt states it. The mapping is WINDOW_SLOT_MAP in src/config/scheduling.ts
// (docs/decisions/0035-window-slot-map.md); which window a time of day falls in, by the day's times, is windowAt in
// src/policy/slot-times.ts.

export const RULES = [
  "The client app offers three windows (9–12, 12–4, 4–8). The dispatch board has four slots a day. Define the mapping in config WINDOW_SLOT_MAP and record it in an ADR. The two designs do not agree, so the mapping must be explicit, not guessed.",
] as const;
