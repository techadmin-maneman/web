// Home's one prompt, in the owner's order: the first that applies, and only one. An invoice just issued is not one
// of them: Home shows it as a second line beneath, whatever the prompt, for as long as ops set (`invoice_prompt`,
// src/policy/next-visit.ts). src/domain/home-prompt.ts reads what each turns on.

export const RULES = [
  "the order (1) no address while something is booked, (2) the next service due and not booked, (3) the piece falling due",
  "an invoice issued in the last 14 days shows as a second line beneath whichever prompt applies, the fortnight a console setting",
] as const;

/** Each prompt, in the owner's order. */
export const HOME_PROMPTS = ["address", "next_visit", "replacement_due"] as const;
export type HomePromptKind = (typeof HOME_PROMPTS)[number];

/** Whether each prompt applies to the client now. */
export type PromptFacts = Readonly<Record<HomePromptKind, boolean>>;

/** The prompt Home shows: the first in the owner's order that applies, or none. */
export const homePromptOf = (facts: PromptFacts): HomePromptKind | null =>
  HOME_PROMPTS.find((kind) => facts[kind]) ?? null;
