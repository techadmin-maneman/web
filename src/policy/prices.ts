// How prices are shown, and where they come from: before GST as the main figure, with the amount with GST beside it,
// and always from the price book, never from a design's words, so a price changed in Settings is the price everywhere.
// The price book is src/domain/money/price-book.ts; each price the API answers carries amount_ex_gst, the main figure,
// beside the amount with GST (PriceSchema, src/routes/schemas/booking.ts).

import { addDays } from "../lib/india-time.ts";

/** The first day a new price can apply from: tomorrow, so a price a client was quoted today never moves under them. */
export const firstPriceDay = (today: string): string => addDays(today, 1);
