// A client moving or cancelling a visit, and ops moving one (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M5.

export const RULES = [
  "More than 24 hours before the window starts: moving or cancelling is free. The payment carries over, or is refunded to its source; a credit comes back.",
  "Inside 24 hours:",
  "a paid service visit is charged, and the new visit is paid separately",
  "a credit booking loses the credit",
  "a first fit costs a late fee of config LATE_FEE_FIRST_FIT (Rs. 4,000 in the design), with the balance carried over",
  "a replacement's late fee is config LATE_FEE_REPLACEMENT (Rs. 3,000 in the design)",
  "When ops move a visit, the client is never charged.",
] as const;

/** Moving or cancelling is free until this long before the window starts. */
export const FREE_CHANGE_NOTICE_HOURS = 24;
