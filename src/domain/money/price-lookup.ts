// How a price is looked up, wherever it is read: the city's own (city_prices) before the book's (price_book), as one
// SQL lookup a statement can hold (docs/decisions/0198-cities-as-data.md). It imports nothing of the book or the
// services, so both may use it.

import { withGst } from "../../config/gst.ts";

/** A price: before GST, with GST, and the rate between them. */
export interface Price {
  readonly amount_ex_gst: number;
  /** GST included: what the client pays. */
  readonly amount: number;
  readonly gst_percent: number;
}

/**
 * The price in force for an item's tier on a day in a city, as SQL over the expressions given, answering
 * json_array(amount_ex_gst, gst_percent), or null: the city's own price where it sets one (city_prices), else the
 * book's (docs/decisions/0198-cities-as-data.md). A null city reads the book alone.
 */
export const priceInForce = (item: string, tier: string, on: string, city: string): string => `COALESCE(
  (SELECT json_array(c.amount_ex_gst, c.gst_percent) FROM city_prices c
    WHERE c.item = ${item} AND c.tier = ${tier} AND c.city = ${city} AND c.valid_from <= ${on}
    ORDER BY c.valid_from DESC LIMIT 1),
  (SELECT json_array(b.amount_ex_gst, b.gst_percent) FROM price_book b
    WHERE b.item = ${item} AND b.tier = ${tier} AND b.valid_from <= ${on}
    ORDER BY b.valid_from DESC LIMIT 1))`;

/** A price as priceInForce answers it; null for none. */
export function priceFrom(json: string | null): Price | null {
  if (json === null) return null;
  const [amountExGst, gstPercent] = JSON.parse(json) as [number, number];
  return { amount_ex_gst: amountExGst, amount: withGst(amountExGst, gstPercent), gst_percent: gstPercent };
}
