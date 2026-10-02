// Home's prompts, board B1: "One card, one prompt, nothing else." The first that applies leads, in the owner's
// order; an invoice just issued is a line of its own beneath whichever leads, and holds the replacement back while
// it shows. src/domain/home-prompt.ts reads what each turns on; how long an invoice is shown is ops' to set
// (`invoice_prompt`, src/policy/next-visit.ts).

export const RULES = [
  "next visit first, invoice-ready as a second line for 14 days, then replacement",
  "the address comes first while something is booked: the technician cannot find the door without one",
  "the replacement is prompted only once its month is within how far ahead a visit may be booked",
] as const;

/** Each prompt, in the owner's order. */
export const HOME_PROMPTS = ["address", "next_visit", "invoice_ready", "replacement_due"] as const;
export type HomePromptKind = (typeof HOME_PROMPTS)[number];

/** Whether each prompt applies to the client now. */
export type PromptFacts = Readonly<Record<HomePromptKind, boolean>>;

/** The prompt Home leads with: the first in the owner's order that applies, or none. */
export const homePromptOf = (facts: PromptFacts): HomePromptKind | null =>
  HOME_PROMPTS.find((kind) => facts[kind]) ?? null;
