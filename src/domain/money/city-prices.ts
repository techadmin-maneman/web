// The prices a city sets apart from the book's (docs/decisions/0198-cities-as-data.md): a service's or a late fee's,
// from a day, which come before the national price there (priceInForce, ../money/price-book.ts). Each is checked as
// a price in the book is, and an old one stays for what was sold under it.

import { exGst } from "../../config/gst.ts";
import { priceRefusal, type PriceItem, type PriceRefusal } from "./price-book.ts";
import { amountOf } from "./price-lookup.ts";
import { auditStatement, type AuditEntry } from "../platform/audit.ts";

/** One of a city's own prices, as Admin › Cities lists it. */
export interface CityPrice {
  readonly city: string;
  readonly item: PriceItem;
  readonly tier: string;
  readonly amount_ex_gst: number;
  /** What the client pays, GST included. */
  readonly amount: number;
  readonly gst_percent: number;
  readonly valid_from: string;
  /** The one in force on the day asked about; the others are spent or still to come. */
  readonly in_force: boolean;
}

/** Every city's own prices, by city, then what they price, the latest first. */
export async function cityPrices(db: D1Database, on: string): Promise<CityPrice[]> {
  const { results } = await db
    .prepare(
      `SELECT city, item, tier, amount_ex_gst, gst_percent, amount_paise AS amount, valid_from FROM city_prices
       ORDER BY city, item, tier, valid_from DESC`,
    )
    .all<Omit<CityPrice, "in_force" | "amount"> & { amount: number | null }>();
  const found = new Set<string>();
  return results.map((row) => {
    const key = `${row.city}/${row.item}/${row.tier}`;
    const inForce = row.valid_from <= on && !found.has(key);
    if (inForce) found.add(key);
    return { ...row, amount: amountOf(row), in_force: inForce };
  });
}

/** A city's own price as ops set one: what the client pays there, GST included. */
export interface CityPriceChange {
  readonly city: string;
  readonly item: PriceItem;
  readonly tier: string;
  readonly amount: number;
  readonly gst_percent: number;
  readonly valid_from: string;
}

/**
 * A city's own price from a day, checked as a price in the book is, with its audit entry in the same batch. The same
 * day set again takes the new figures.
 */
export async function setCityPrice(
  db: D1Database,
  price: CityPriceChange,
  audit: Omit<AuditEntry, "action" | "subject">,
  { now, today }: { readonly now: Date; readonly today: string },
): Promise<PriceRefusal | null> {
  const refusal = await priceRefusal(db, price, today);
  if (refusal !== null) return refusal;
  await db.batch([
    db
      .prepare(
        `INSERT INTO city_prices (item, tier, city, amount_ex_gst, gst_percent, amount_paise, valid_from)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (item, tier, city, valid_from) DO UPDATE SET
           amount_ex_gst = excluded.amount_ex_gst, gst_percent = excluded.gst_percent, amount_paise = excluded.amount_paise`,
      )
      .bind(
        price.item,
        price.tier,
        price.city,
        exGst(price.amount, price.gst_percent),
        price.gst_percent,
        price.amount,
        price.valid_from,
      ),
    auditStatement(
      db,
      {
        ...audit,
        action: "city_price.set",
        subject: { kind: "city", id: price.city },
        detail: {
          item: price.item,
          tier: price.tier,
          valid_from: price.valid_from,
          amount: price.amount,
          gst_percent: price.gst_percent,
        },
      },
      now,
    ),
  ]);
  return null;
}

/** A city's price still to come taken back, so the price in force there stays; false for none still to come. */
export async function withdrawCityPrice(
  db: D1Database,
  price: Pick<CityPriceChange, "city" | "item" | "tier" | "valid_from">,
  audit: Omit<AuditEntry, "action" | "subject">,
  { now, today }: { readonly now: Date; readonly today: string },
): Promise<boolean> {
  const held = await db
    .prepare("SELECT 1 FROM city_prices WHERE item = ?1 AND tier = ?2 AND city = ?3 AND valid_from = ?4 AND ?4 > ?5")
    .bind(price.item, price.tier, price.city, price.valid_from, today)
    .first();
  if (held === null) return false;
  await db.batch([
    db
      .prepare("DELETE FROM city_prices WHERE item = ?1 AND tier = ?2 AND city = ?3 AND valid_from = ?4")
      .bind(price.item, price.tier, price.city, price.valid_from),
    auditStatement(
      db,
      {
        ...audit,
        action: "city_price.withdraw",
        subject: { kind: "city", id: price.city },
        detail: { item: price.item, tier: price.tier, valid_from: price.valid_from },
      },
      now,
    ),
  ]);
  return true;
}
