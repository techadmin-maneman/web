// When the client is not home (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them; their code arrives in P2-M4.

export const RULES = [
  "The wait timer starts at check-in and runs config NO_SHOW_WAIT_MIN (15) minutes.",
  "Close as no-show is disabled until the timer ends.",
  "Ops then receive three facts: check-in time, distance, and the delivery receipt of the day-before or arrival WhatsApp to the client (from the BSP's delivery webhook).",
  "A no-show is charged under the 24-hour policy. The charge is applied by ops from the evidence, never automatically.",
] as const;
