// Arriving at a job (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them; their code arrives in P2-M4.

export const RULES = [
  "I have arrived records the time and the device's position, and passes only within config CHECKIN_RADIUS_M (200 m) of the address.",
] as const;
