// How prices are shown, and where they come from (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them; their code arrives in P2-M2.

export const RULES = [
  "Shown ex-GST as the main figure, with the GST-inclusive amount beside it. Prices come from a price book (below), never from design strings.",
] as const;
