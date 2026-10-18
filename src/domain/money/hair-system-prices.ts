// What each hair system sells for (docs/decisions/0211-packages.md): a price of its own in the book, under the item
// hair_system and its stock code, so a first fit costs the hair system made to the client and its package's service
// visit (src/policy/packages.ts). It imports nothing of the services, so they may read it.

import { priceFrom, priceInForce, type Price } from "./price-lookup.ts";

/** A hair system on sale on a day, with its price then. */
export interface HairSystemPrice {
  readonly code: string;
  /** The package it is sold in. */
  readonly product: string;
  readonly price: Price | null;
}

/**
 * Every hair system priced by a day and not retired by it, with its price that day in a city: the city's own, else
 * the book's. It reads the hair systems the book prices, by its key, so the hourly catalogue check reads as many rows
 * however many hair systems are kept unpriced.
 */
export async function hairSystemPricesOn(
  db: D1Database,
  on: string,
  city: string | null = null,
): Promise<HairSystemPrice[]> {
  const { results } = await db
    .prepare(
      `SELECT h.code, h.product, ${priceInForce("'hair_system'", "h.code", "?1", "?2")} AS price
       FROM hair_systems h JOIN consumables c ON c.code = h.code
       WHERE h.code IN (SELECT b.tier FROM price_book b WHERE b.item = 'hair_system' AND b.valid_from <= ?1
           UNION SELECT p.tier FROM city_prices p WHERE p.item = 'hair_system' AND p.city = ?2 AND p.valid_from <= ?1)
         AND (c.retired_date IS NULL OR c.retired_date > ?1)`,
    )
    .bind(on, city)
    .all<{ code: string; product: string; price: string | null }>();
  return results.map((row) => ({ code: row.code, product: row.product, price: priceFrom(row.price) }));
}
