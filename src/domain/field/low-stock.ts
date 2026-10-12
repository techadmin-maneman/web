// Low stock (src/domain/field/stock.ts keeps the ledger): what a place holds at or below its level, the alert that says so,
// and its closing once nothing is low there, after a movement, a retirement or the hourly look. Apart from the ledger
// and the Stock screen, so the cron imports it alone.

import { indiaDate } from "../../lib/india-time.ts";
import { isLow } from "../../policy/stock.ts";
import type { AlertOnce, ResolveAlert } from "../ops/alerts.ts";
import { WAREHOUSE, type Place } from "./stock-places.ts";

/** One consumable a place holds at or below its level. */
interface Low {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly held: number;
  readonly level: number;
}

/**
 * What a place holds at or below its level, of every consumable still offered that has one: a kit by the kit's level,
 * the warehouse, a hub and a stockroom by the central one.
 */
async function lowAt(db: D1Database, place: Place, today: string): Promise<Low[]> {
  const { results } = await db
    .prepare(
      `SELECT c.code, c.name, c.unit,
         CASE WHEN (SELECT kind FROM stock_places WHERE id = ?1) = 'kit' THEN c.reorder_kit ELSE c.reorder_central END
           AS level,
         COALESCE((SELECT b.quantity FROM stock_balances b WHERE b.consumable_code = c.code AND b.place = ?1), 0) AS held
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

const CENTRAL_KEY = "low_stock:central";
const KIT_KEY = "low_stock:kit:";
const STORE_KEY = "low_stock:store:";

interface Where {
  readonly kind: string;
  readonly name: string | null;
}

async function whereOf(db: D1Database, place: Place): Promise<Where | null> {
  return db.prepare("SELECT kind, name FROM stock_places WHERE id = ?1").bind(place).first<Where>();
}

/** A place's alert: the warehouse keeps the central store's, a kit its technician's, a hub and a stockroom their own. */
const lowStockKey = (place: Place, where: Where | null): string => {
  if (place === WAREHOUSE) return CENTRAL_KEY;
  return where?.kind === "kit" ? `${KIT_KEY}${place}` : `${STORE_KEY}${place}`;
};

/** Where stock is low, as the chat is told: a kit by its technician's ID alone, any other place by its name. */
const placeWords = (place: Place, where: Where | null): string => {
  if (where?.kind === "kit") return `technician ${place}'s kit`;
  return where?.name ?? place;
};

/** The place an open alert is about, by its key. */
const placeOfKey = (key: string): Place => {
  if (key === CENTRAL_KEY) return WAREHOUSE;
  return key.startsWith(KIT_KEY) ? key.slice(KIT_KEY.length) : key.slice(STORE_KEY.length);
};

/**
 * The open alerts as the console shows them: a low kit named by its technician, which the chat is never told. Every
 * other alert's message is as it was sent.
 */
export async function namedForTheConsole<A extends { readonly key: string; readonly message: string }>(
  db: D1Database,
  alerts: readonly A[],
): Promise<A[]> {
  const kitOf = (alert: A) => (alert.key.startsWith(KIT_KEY) ? alert.key.slice(KIT_KEY.length) : null);
  const kits = alerts.flatMap((alert) => kitOf(alert) ?? []);
  if (kits.length === 0) return [...alerts];
  const { results } = await db
    .prepare("SELECT id, name FROM technicians WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(kits))
    .all<{ id: string; name: string }>();
  const names = new Map(results.map((row) => [row.id, row.name]));
  return alerts.map((alert) => {
    const kit = kitOf(alert);
    const name = kit === null ? undefined : names.get(kit);
    if (kit === null || name === undefined) return alert;
    return { ...alert, message: alert.message.replace(`technician ${kit}'s kit`, `${name}'s kit`) };
  });
}

/**
 * After a movement: one alert for a place that went down and is low, naming
 * all it is low on; the place's alert closed once it is low on nothing. A
 * place that only gained stock is told nothing new. The message carries the
 * technician's ID, never their name (src/domain/ops/alerts.ts).
 */
export async function tellOfLowStock(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert; readonly now: () => Date },
  places: { readonly touched: readonly Place[]; readonly lowered: readonly Place[] },
): Promise<void> {
  const today = indiaDate(deps.now());
  for (const place of new Set(places.touched)) {
    const low = await lowAt(db, place, today);
    const where = await whereOf(db, place);
    const key = lowStockKey(place, where);
    if (low.length === 0) {
      await deps.resolveAlert(key);
      continue;
    }
    if (!places.lowered.includes(place)) continue;
    const at = placeWords(place, where);
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
  const places = results.map(({ key }) => placeOfKey(key));
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
