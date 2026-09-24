// What things cost, from the price book (migrations/0016_booking.sql): the only
// source of prices for the app. Amounts are in paise.
//
// Ops set every price from the console, each from the date it applies
// (docs/decisions/0060-ops-editable-inputs.md). A change is a new row and never
// an edit, so an invoice already issued keeps the figure it was issued under
// and priceOf still reads that row for that day.

import { withGst } from "../config/gst.ts";
import { PRICE_BOUNDS } from "../config/ops-settings.ts";
import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { auditStatement, type AuditActor } from "./audit.ts";

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

/** One row of the book, as the console lists it. */
export interface PriceRow {
  readonly item: string;
  readonly tier: string;
  readonly amount_ex_gst: number;
  readonly gst_percent: number;
  readonly valid_from: string;
  /** The row that applies on the day asked about; the others are spent or still to come. */
  readonly in_force: boolean;
}

/** The whole book, newest first within each item and tier, with the row in force on `on` marked. */
export async function priceBook(db: D1Database, on: string): Promise<PriceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT item, tier, amount_ex_gst, gst_percent, valid_from FROM price_book
       ORDER BY item, tier, valid_from DESC`,
    )
    .all<Omit<PriceRow, "in_force">>();

  const found = new Set<string>();
  return results.map((row) => {
    const key = `${row.item}/${row.tier}`;
    const inForce = row.valid_from <= on && !found.has(key);
    if (inForce) found.add(key);
    return { ...row, in_force: inForce };
  });
}

/** Why a price cannot be set: the field, and what that field will take. */
export interface PriceRefusal {
  readonly field: string;
  readonly says: string;
}

export function checkPrice(
  price: { readonly amount_ex_gst: number; readonly gst_percent: number; readonly valid_from: string },
  today: string,
): PriceRefusal | null {
  const { minPaise, maxPaise, minGstPercent, maxGstPercent } = PRICE_BOUNDS;
  if (!Number.isInteger(price.amount_ex_gst) || price.amount_ex_gst < minPaise || price.amount_ex_gst > maxPaise) {
    return { field: "amount_ex_gst", says: `A price runs from 0 to ${String(maxPaise / 100_000)} lakh rupees.` };
  }
  if (price.amount_ex_gst % 100 !== 0) return { field: "amount_ex_gst", says: "A price is in whole rupees." };
  if (!Number.isInteger(price.gst_percent) || price.gst_percent < minGstPercent || price.gst_percent > maxGstPercent) {
    return {
      field: "gst_percent",
      says: `GST is a whole percentage from ${String(minGstPercent)} to ${String(maxGstPercent)}.`,
    };
  }
  // A past date would change what a visit already invoiced was charged.
  if (price.valid_from < today) return { field: "valid_from", says: "A price applies from today or a day after it." };
  return null;
}

/**
 * Writes a price from a date, with its audit entry in the same batch: a change
 * that is not recorded does not happen (ADR 0031). A second write for the same
 * day corrects that day's figure rather than adding a row beside it.
 */
export async function setPrice(
  db: D1Database,
  input: {
    readonly price: {
      readonly item: string;
      readonly tier: string;
      readonly amount_ex_gst: number;
      readonly gst_percent: number;
      readonly valid_from: string;
    };
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<void> {
  const { price, actor, requestId, now } = input;
  const was = await priceOf(db, price.item as PriceItem, indiaDate(now), price.tier);
  await db.batch([
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "price.set",
        subject: { kind: "price", id: `${price.item}/${price.tier}` },
        requestId,
        detail: {
          // -1 where the book had no price for it at all, which no amount can be.
          from: was?.amount_ex_gst ?? -1,
          to: price.amount_ex_gst,
          gst_percent: price.gst_percent,
          valid_from: price.valid_from,
        },
      },
      now,
    ),
    db
      .prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (item, tier, valid_from) DO UPDATE SET
           amount_ex_gst = excluded.amount_ex_gst, gst_percent = excluded.gst_percent`,
      )
      .bind(price.item, price.tier, price.amount_ex_gst, price.gst_percent, price.valid_from),
  ]);
}
