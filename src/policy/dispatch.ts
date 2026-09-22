// The dispatch board (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them; their code arrives in P2-M4.

export const RULES = [
  "Rows are technicians; columns are seven days; each day has config SLOTS_PER_DAY (4) slots.",
  "Blocks are sized in slots: consultation 1, service 1, replacement 1.5, first fit 2. Sizes come from the price book's visit types.",
  "A technician cannot hold two live jobs in one window on one date. This check runs on the server before any write to FSM.",
  "The client's payment carries over and he is never charged for a move ops make, including inside 24 hours.",
  "Leave periods come from FSM technician availability.",
] as const;
