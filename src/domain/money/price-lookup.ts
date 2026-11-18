// How a price is looked up, wherever it is read: the city's own (city_prices) before the book's (price_book), as one
// SQL lookup a statement can hold (docs/decisions/0198-cities-as-data.md). It imports nothing of the book or the
// services, so both may use it.

import { exGst, withGst } from "../../config/gst.ts";
import { z } from "zod";
import { storedJson } from "../../lib/stored-json.ts";

/** A price: before GST, with GST, and the rate between them. */
export interface Price {
  readonly amount_ex_gst: number;
  /** GST included: what the client pays. */
  readonly amount: number;
  readonly gst_percent: number;
}

/**
 * The price in force for an item's tier on a day in a city, as SQL over the expressions given, answering
 * json_array(amount_ex_gst, gst_percent, amount), or null: the city's own price where it sets one (city_prices), else
 * the book's. A null city reads the book alone.
 */
export const priceInForce = (item: string, tier: string, on: string, city: string): string => `COALESCE(
  (SELECT json_array(c.amount_ex_gst, c.gst_percent, c.amount) FROM city_prices c
    WHERE c.item = ${item} AND c.tier = ${tier} AND c.city = ${city} AND c.valid_from <= ${on}
    ORDER BY c.valid_from DESC LIMIT 1),
  (SELECT json_array(b.amount_ex_gst, b.gst_percent, b.amount) FROM price_book b
    WHERE b.item = ${item} AND b.tier = ${tier} AND b.valid_from <= ${on}
    ORDER BY b.valid_from DESC LIMIT 1))`;

/**
 * What priceInForce answers: the amount before GST, the GST percent, and the amount GST included, which a row set
 * before prices were set with their GST leaves empty (docs/decisions/0274-gst-on.md).
 */
const PRICE_ROW = z.tuple([z.number(), z.number(), z.number().nullable()]);

/** A row of the book or a city's prices as it is stored. */
interface StoredPrice {
  readonly amount_ex_gst: number;
  readonly gst_percent: number;
  readonly amount: number | null;
}

/**
 * What the client pays for a row: its amount as ops set it, while the figure before GST still comes from it; else
 * that figure with GST added, as for a row with no amount, or one a Worker from before amounts changed since.
 */
export function amountOf(row: StoredPrice): number {
  if (row.amount !== null && exGst(row.amount, row.gst_percent) === row.amount_ex_gst) return row.amount;
  return withGst(row.amount_ex_gst, row.gst_percent);
}

/** A price as priceInForce answers it; null for none. */
export function priceFrom(json: string | null): Price | null {
  if (json === null) return null;
  const [amountExGst, gstPercent, amount] = storedJson(PRICE_ROW, json, "priceInForce");
  return {
    amount_ex_gst: amountExGst,
    amount: amountOf({ amount_ex_gst: amountExGst, gst_percent: gstPercent, amount }),
    gst_percent: gstPercent,
  };
}
