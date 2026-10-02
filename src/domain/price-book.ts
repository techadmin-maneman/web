// What things cost, from the price book (migrations/0016_booking.sql): the only
// source of prices for the app. Amounts are in paise.
//
// Ops set every price from the console, each from the date it applies
// (docs/decisions/0061-ops-editable-inputs.md). A change from a new date is a
// new row; a second change for the same date corrects that date's row. What a
// client was sold never moves with either: a hold keeps its price and its late
// fee, and a payment the split before GST it was taken at
// (docs/decisions/0068-a-paid-hold-is-kept.md).
//
// A visit's price is its service's: the row's item is the service's kind and
// its tier the service's code, so a price is set only for a service the
// services table holds, and not from a day it is retired by. The two late fees
// are items of their own, one figure a kind (docs/decisions/0085-services-ops-can-edit.md).

import { withGst } from "../config/gst.ts";
import { PRICE_BOUNDS } from "../config/ops-settings.ts";
import { STANDARD_TIER, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { isOffered } from "../policy/services.ts";
import { auditStatement, type AuditActor, type AuditEntry } from "./audit.ts";
import { serviceOf } from "./services.ts";

/** What the book prices: each kind of visit, by its services' tiers, and the two late fees. */
export const PRICE_ITEMS = [...VISIT_TYPES, "late_fee_first_fit", "late_fee_replacement"] as const;
export type PriceItem = (typeof PRICE_ITEMS)[number];

export interface Price {
  readonly amount_ex_gst: number;
  /** GST included: what the client pays. */
  readonly amount: number;
  readonly gst_percent: number;
}

/** The price of an item's tier on a day (India's date, YYYY-MM-DD); null when the book has none. */
export async function priceOf(db: D1Database, item: PriceItem, on: string, tier: string): Promise<Price | null> {
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

/** A late fee on a day: one figure a kind, kept under the standard tier. */
export function lateFeeOn(
  db: D1Database,
  item: "late_fee_first_fit" | "late_fee_replacement",
  on: string,
): Promise<Price | null> {
  return priceOf(db, item, on, STANDARD_TIER);
}

/** One row of the book, as the console lists it. */
export interface PriceRow {
  readonly item: PriceItem;
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

/**
 * Why a price cannot be set: the field, and what that field will take. `retired` where the service it prices is
 * retired by the day it would apply from.
 */
export interface PriceRefusal {
  readonly field: string;
  readonly says: string;
  readonly retired?: true;
}

/** A price as ops set one: what it prices, from when, and its figures. */
export interface PriceChange {
  readonly item: PriceItem;
  readonly tier: string;
  readonly amount_ex_gst: number;
  readonly gst_percent: number;
  readonly valid_from: string;
}

const isVisit = (item: PriceItem): item is VisitType => VISIT_TYPES.some((type) => type === item);

/**
 * Why this price cannot be set, or null when it can: its figures and its day first (checkPrice), then what it
 * prices. A visit's price is its service's, so the service must be one the table holds and still offered on the
 * day the price applies from; a late fee is one figure a kind, its standard tier's.
 */
export async function priceRefusal(db: D1Database, price: PriceChange, today: string): Promise<PriceRefusal | null> {
  const figures = checkPrice(price, today);
  if (figures !== null) return figures;
  if (!isVisit(price.item)) {
    if (price.tier === STANDARD_TIER) return null;
    return { field: "tier", says: "A late fee has one figure for its kind of visit, the standard tier's." };
  }
  const service = await serviceOf(db, price.item, price.tier);
  if (service === null) return { field: "tier", says: "No service of that kind has that code. Add the service first." };
  if (!isOffered(service.retired_date, price.valid_from)) {
    return { field: "valid_from", says: "The service is retired by that day.", retired: true };
  }
  return null;
}

function checkPrice(
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

/** A row of the book, named by what it prices and the day it applies from. */
export interface PriceRowKey {
  readonly item: PriceItem;
  readonly tier: string;
  readonly valid_from: string;
}

/** Who changed a price, for the audit entries written with it. */
interface PriceWrite {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** A row still to come, and what it holds; "not_found" or "not_to_come" where it cannot be taken back. */
async function toTakeBack(
  db: D1Database,
  row: PriceRowKey,
  today: string,
): Promise<{ amount_ex_gst: number; gst_percent: number } | "not_found" | "not_to_come"> {
  const held = await db
    .prepare("SELECT amount_ex_gst, gst_percent FROM price_book WHERE item = ?1 AND tier = ?2 AND valid_from = ?3")
    .bind(row.item, row.tier, row.valid_from)
    .first<{ amount_ex_gst: number; gst_percent: number }>();
  if (held === null) return "not_found";
  return row.valid_from <= today ? "not_to_come" : held;
}

/** Taking a row back: its audit entry, holding what it would have been, then the delete. */
function takingBack(
  db: D1Database,
  row: PriceRowKey,
  held: { amount_ex_gst: number; gst_percent: number },
  write: PriceWrite,
): D1PreparedStatement[] {
  const entry: AuditEntry = {
    surface: "ops",
    actor: write.actor,
    action: "price.withdraw",
    subject: { kind: "price", id: `${row.item}/${row.tier}` },
    requestId: write.requestId,
    detail: { amount_ex_gst: held.amount_ex_gst, gst_percent: held.gst_percent, valid_from: row.valid_from },
  };
  return [
    auditStatement(db, entry, write.now),
    db
      .prepare("DELETE FROM price_book WHERE item = ?1 AND tier = ?2 AND valid_from = ?3")
      .bind(row.item, row.tier, row.valid_from),
  ];
}

/**
 * Setting a price: its audit entry, from what the item costs today, then the row. A second write for the same day
 * corrects that day's figure rather than adding a row beside it.
 */
async function setting(db: D1Database, price: PriceChange, write: PriceWrite): Promise<D1PreparedStatement[]> {
  const was = await priceOf(db, price.item, indiaDate(write.now), price.tier);
  const entry: AuditEntry = {
    surface: "ops",
    actor: write.actor,
    action: "price.set",
    subject: { kind: "price", id: `${price.item}/${price.tier}` },
    requestId: write.requestId,
    detail: {
      // -1 where the book had no price for it at all, which no amount can be.
      from: was?.amount_ex_gst ?? -1,
      to: price.amount_ex_gst,
      gst_percent: price.gst_percent,
      valid_from: price.valid_from,
    },
  };
  return [
    auditStatement(db, entry, write.now),
    db
      .prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (item, tier, valid_from) DO UPDATE SET
           amount_ex_gst = excluded.amount_ex_gst, gst_percent = excluded.gst_percent`,
      )
      .bind(price.item, price.tier, price.amount_ex_gst, price.gst_percent, price.valid_from),
  ];
}

/**
 * Takes back a price still to come, with its audit entry in the same batch.
 * Only a row that applies after today can go: the one in force and every spent
 * one may already stand on an invoice, and a hold keeps the figure it was
 * quoted in any case (docs/decisions/0068-a-paid-hold-is-kept.md).
 */
export async function withdrawPrice(
  db: D1Database,
  input: PriceWrite & { readonly row: PriceRowKey },
): Promise<"withdrawn" | "not_found" | "not_to_come"> {
  const held = await toTakeBack(db, input.row, indiaDate(input.now));
  if (typeof held === "string") return held;
  await db.batch(takingBack(db, input.row, held, input));
  return "withdrawn";
}

/**
 * Writes a price from a date, with its audit entry in the same batch: a change
 * that is not recorded does not happen (ADR 0031).
 */
export async function setPrice(db: D1Database, input: PriceWrite & { readonly price: PriceChange }): Promise<void> {
  await db.batch(await setting(db, input.price, input));
}

/**
 * Corrects a price still to come: takes its row back and sets the one that replaces it, from the same day or
 * another, in one batch, so the book never stands between the two. Each is audited as it would be alone. The row
 * in force and every spent one stay, as they do for withdrawPrice.
 */
export async function correctPrice(
  db: D1Database,
  input: PriceWrite & { readonly was: PriceRowKey; readonly price: PriceChange },
): Promise<"corrected" | "not_found" | "not_to_come"> {
  const held = await toTakeBack(db, input.was, indiaDate(input.now));
  if (typeof held === "string") return held;
  await db.batch([...takingBack(db, input.was, held, input), ...(await setting(db, input.price, input))]);
  return "corrected";
}
