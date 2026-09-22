// Who may log in to the technician app (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them; their code arrives in P2-M4.

export const RULES = [
  "Mobile number plus a one-time code, the same flow as clients but a separate role.",
  "A technician is recognised only if FSM lists him as an active field technician.",
  "His sessions are bound to a device and can be revoked by ops. Revoking also wipes the device's cached jobs on its next contact.",
] as const;
