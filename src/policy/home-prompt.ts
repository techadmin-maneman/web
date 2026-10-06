// Home's prompts: "One card, one prompt, nothing else." The first that applies leads, in the order below; an invoice just issued is a line of its own beneath whichever leads, and holds the replacement back while
// it shows. src/domain/home-prompt.ts reads what each turns on; how long an invoice is shown is ops' to set
// (`invoice_prompt`, src/policy/next-visit.ts).

/** Each prompt, the first to lead first. */
export const HOME_PROMPTS = ["address", "next_visit", "invoice_ready", "replacement_due"] as const;
export type HomePromptKind = (typeof HOME_PROMPTS)[number];

/** Whether each prompt applies to the client now. */
export type PromptFacts = Readonly<Record<HomePromptKind, boolean>>;

/** The prompt Home leads with: the first in HOME_PROMPTS that applies, or none. */
export const homePromptOf = (facts: PromptFacts): HomePromptKind | null =>
  HOME_PROMPTS.find((kind) => facts[kind]) ?? null;
