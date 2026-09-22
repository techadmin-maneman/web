// What a technician sees of each job, and when (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them; their code arrives in P2-M4.

export const RULES = [
  "Today's jobs in order; tomorrow collapsed.",
  "Jobs further out show only time, type and sector. The address, access notes and client card unlock the day before, and the API enforces this, not just the screen.",
  "A job shows a Prepaid or Credit badge only, and no API response to a technician carries an amount.",
] as const;
