// What things cost, from the price book (migrations/0016_booking.sql): the only
// source of prices for the app. Amounts are in paise.

import { withGst } from "../config/gst.ts";
import type { VisitType } from "../config/visit-types.ts";

export type PriceItem = VisitType | "late_fee_first_fit" | "late_fee_replacement";

export interface Price {
  readonly amount_ex_gst: number;
  /** GST included: what the client pays. */
  readonly amount: number;
  readonly gst_percent: number;
}

/** The price of an item on a day (India's date, YYYY-MM-DD); null when the book has none. */
export async function priceOf(db: D1Database, item: PriceItem, on: string, tier = "standard"): Promise<Price | null> {
  const row = await db
    .prepare(
      `SELECT amount_ex_gst, gst_percent FROM price_book
       WHERE item = ?1 AND tier = ?2 AND valid_from <= ?3 ORDER BY valid_from DESC LIMIT 1`,
    )
    .bind(item, tier, on)
    .first<{ amount_ex_gst: number; gst_percent: number }>();
  if (row === null) return null;
  return {
    amount_ex_gst: row.amount_ex_gst,
    amount: withGst(row.amount_ex_gst, row.gst_percent),
    gst_percent: row.gst_percent,
  };
}
