// How prices are shown, and where they come from (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them. The price book is src/domain/price-book.ts; each price the API answers
// carries amount_ex_gst, the main figure, beside the amount with GST (PriceSchema, src/routes/client/booking.ts).

import { addDays } from "../lib/india-time.ts";

// Its rules, as the brief states them:
// - Shown ex-GST as the main figure, with the GST-inclusive amount beside it. Prices come from a price book (below),
//   never from design strings.

/** The first day a new price can apply from: tomorrow, so a price a client was quoted today never moves under them. */
export const firstPriceDay = (today: string): string => addDays(today, 1);
