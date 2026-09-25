// How prices are shown, and where they come from (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them. The price book is src/domain/price-book.ts; each price the API answers
// carries amount_ex_gst, the main figure, beside the amount with GST (PriceSchema, src/routes/client-booking.ts).

export const RULES = [
  "Shown ex-GST as the main figure, with the GST-inclusive amount beside it. Prices come from a price book (below), never from design strings.",
] as const;
