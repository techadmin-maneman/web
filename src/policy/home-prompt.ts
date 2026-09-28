// Home's one prompt (design/phase2/Client App, board B1: "One card, one prompt, nothing else"), in the order the
// owner gave on 27 September 2026 (docs/owner-answers-2026-09-27.md, item 46): the first that applies, and only
// one. src/domain/home-prompt.ts reads what each turns on; how long an invoice is shown is ops' to set
// (`invoice_prompt`, src/policy/next-visit.ts).

export const RULES = [
  "the order (1) no address while something is booked, (2) the next service due and not booked, (3) the piece falling due, (4) an invoice issued in the last 14 days, the fortnight a console setting",
] as const;

/** Each prompt, in the owner's order. */
export const HOME_PROMPTS = ["address", "next_visit", "replacement_due", "invoice_ready"] as const;
export type HomePromptKind = (typeof HOME_PROMPTS)[number];

/** Whether each prompt applies to the client now. */
export type PromptFacts = Readonly<Record<HomePromptKind, boolean>>;

/** The prompt Home shows: the first in the owner's order that applies, or none. */
export const homePromptOf = (facts: PromptFacts): HomePromptKind | null =>
  HOME_PROMPTS.find((kind) => facts[kind]) ?? null;
