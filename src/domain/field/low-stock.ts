// Low stock (src/domain/field/stock.ts keeps the ledger): what a place holds at or below its level, the alert that says so,
// and its closing once nothing is low there, after a movement, a retirement or the hourly look. Apart from the ledger
// and the Stock screen, so the cron imports it alone.

import { indiaDate } from "../../lib/india-time.ts";
import { isLow } from "../../policy/stock.ts";
import type { AlertOnce, ResolveAlert } from "../ops/alerts.ts";
import type { Place } from "./stock.ts";

/** One consumable a place holds at or below its level. */
interface Low {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly held: number;
  readonly level: number;
}

/** What a place holds at or below its level, of every consumable still offered that has one. */
async function lowAt(db: D1Database, place: Place, today: string): Promise<Low[]> {
  const { results } = await db
    .prepare(
      `SELECT c.code, c.name, c.unit, CASE WHEN ?1 IS NULL THEN c.reorder_central ELSE c.reorder_kit END AS level,
         COALESCE((SELECT b.quantity FROM stock_balances b
           WHERE b.consumable_code = c.code AND b.place = COALESCE(?1, 'central')), 0) AS held
       FROM consumables c
       WHERE c.retired_date IS NULL OR c.retired_date > ?2
       ORDER BY c.name COLLATE NOCASE`,
    )
    .bind(place, today)
    .all<{ code: string; name: string; unit: string; level: number | null; held: number }>();
  return results.flatMap((row) =>
    row.level !== null && isLow(row.held, row.level) ? [{ ...row, level: row.level }] : [],
  );
}

const lowStockKey = (place: Place) => (place === null ? "low_stock:central" : `low_stock:kit:${place}`);

/**
 * After a movement: one alert for a place that went down and is low, naming
 * all it is low on; the place's alert closed once it is low on nothing. A
 * place that only gained stock is told nothing new. The message carries the
 * technician's ID, never his name (src/domain/ops/alerts.ts).
 */
export async function tellOfLowStock(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert; readonly now: () => Date },
  places: { readonly touched: readonly Place[]; readonly lowered: readonly Place[] },
): Promise<void> {
  const today = indiaDate(deps.now());
  for (const place of new Set(places.touched)) {
    const low = await lowAt(db, place, today);
    const key = lowStockKey(place);
    if (low.length === 0) {
      await deps.resolveAlert(key);
      continue;
    }
    if (!places.lowered.includes(place)) continue;
    const at = place === null ? "the central store" : `technician ${place}'s kit`;
    const items = low.map((each) => `${each.name} ${String(each.held)} ${each.unit} (level ${String(each.level)})`);
    await deps.alertOnce({
      key,
      message: `Stock is low in ${at}: ${items.join(", ")}. Record a transfer or a delivery on the Stock page.`,
      link: "/stock",
    });
  }
}

/**
 * Closes each open low-stock alert whose place is no longer low: a consumable retired no longer counts (lowAt), and
 * no movement would look again. Run each hour, which also sees a retirement dated for a later day come round, and
 * as one is retired. Opens no alert of its own.
 */
export async function closeStaleLowStock(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert; readonly now: () => Date },
): Promise<void> {
  const { results } = await db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND key >= 'low_stock:' AND key < 'low_stock;'")
    .all<{ key: string }>();
  const places = results.map(({ key }) => (key === lowStockKey(null) ? null : key.slice("low_stock:kit:".length)));
  await tellOfLowStock(db, deps, { touched: places, lowered: [] });
}

/** How many places hold something at or below its level, by their open low-stock alerts: the console's Stock badge. */
export async function lowStockPlaces(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS places FROM alerts WHERE resolved_at IS NULL AND key >= 'low_stock:' AND key < 'low_stock;'",
    )
    .first<{ places: number }>();
  return row?.places ?? 0;
}
