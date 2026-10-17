// Low stock (src/domain/inventory/stock.ts keeps the ledger): what a place holds at or below its level, one alert for
// each item at each place, and its closing once the item is no longer low there, after a movement, a retirement or the
// hourly look. Each kind of place has its level: a kit its own, a city stockroom or a hub the stores', the warehouse
// the central one. Apart from the ledger and the Stock screen, so the cron imports it alone.

import { indiaDate } from "../../lib/india-time.ts";
import { isLow } from "../../policy/stock.ts";
import type { AlertOnce, ResolveAlert } from "../platform/alerts.ts";
import { WAREHOUSE, type Place } from "./stock-places.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";

/** One consumable a place holds at or below its level. */
interface Low {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly held: number;
  readonly level: number;
}

/**
 * What a place holds at or below its level, of every consumable still offered that has one there: a kit by the kit's
 * level, a hub and a stockroom by the stores', the warehouse by the central one.
 */
async function lowAt(db: D1Database, place: Place, today: string): Promise<Low[]> {
  const { results } = await db
    .prepare(
      `SELECT c.code, c.name, c.unit,
         CASE (SELECT kind FROM stock_places WHERE id = ?1)
           WHEN 'kit' THEN c.reorder_kit WHEN 'warehouse' THEN c.reorder_central ELSE c.reorder_store END AS level,
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

const PREFIX = "low_stock:";
const CENTRAL = "central";
const KIT = "kit:";
const STORE = "store:";
/** A kit short for tomorrow or the week (./kit-check.ts): "kit_short:<technician>:<day>". */
const KIT_SHORT = "kit_short:";

interface Where {
  readonly kind: string;
  readonly name: string | null;
}

const whereOf = (db: D1Database, place: Place): Promise<Where | null> =>
  db.prepare("SELECT kind, name FROM stock_places WHERE id = ?1").bind(place).first<Where>();

/** A place's part of its alerts' keys: the warehouse the central store's, a kit its technician's, any other its own. */
const placeKey = (place: Place, where: Where | null): string => {
  if (place === WAREHOUSE) return CENTRAL;
  return where?.kind === "kit" ? `${KIT}${place}` : `${STORE}${place}`;
};

/** Where stock is low, as the chat is told: a kit by its technician's ID, which the console names; any other by its name. */
const placeWords = (place: Place, where: Where | null): string =>
  where?.kind === "kit" ? `technician ${place}'s kit` : (where?.name ?? place);

/** The place an open alert is about, and its item; an alert from before one alert an item names no item. */
function ofKey(key: string): { readonly place: Place; readonly code: string | null } {
  const [first = "", second, third] = key.slice(PREFIX.length).split(":");
  if (first === CENTRAL) return { place: WAREHOUSE, code: second ?? null };
  return { place: second ?? "", code: third ?? null };
}

/** The open low-stock alerts of a place, by key. */
async function openAt(db: D1Database, key: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND (key = ?1 OR (key >= ?2 AND key < ?3))")
    .bind(key, `${key}:`, `${key};`)
    .all<{ key: string }>();
  return results.map((row) => row.key);
}

/**
 * The open alerts as the console shows them: a kit low or short, which the chat is told of by its technician's ID,
 * named by them. Every other alert's message is as it was sent.
 */
export async function namedForTheConsole<A extends { readonly key: string; readonly message: string }>(
  db: D1Database,
  alerts: readonly A[],
): Promise<A[]> {
  const kitOf = (alert: A) => {
    if (alert.key.startsWith(`${PREFIX}${KIT}`)) return ofKey(alert.key).place;
    return alert.key.startsWith(KIT_SHORT) ? (alert.key.slice(KIT_SHORT.length).split(":")[0] ?? null) : null;
  };
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
 * After a movement: one alert for each item a place that went down is low on, and each of the place's alerts closed
 * once its item is no longer low there. A place that only gained stock is told nothing new.
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
    const key = `${PREFIX}${placeKey(place, where)}`;
    const still = new Set(low.map((each) => `${key}:${each.code}`));
    for (const open of await openAt(db, key)) if (!still.has(open)) await deps.resolveAlert(open);
    if (!places.lowered.includes(place)) continue;
    const at = placeWords(place, where);
    for (const each of low) {
      await deps.alertOnce({
        key: `${key}:${each.code}`,
        message: ALERT_WORDS.low_stock({ item: each.name, at, held: each.held, unit: each.unit, level: each.level }),
        link: "/stock",
      });
    }
  }
}

/**
 * Closes each open low-stock alert whose item is no longer low at its place: a consumable retired no longer counts
 * (lowAt), and no movement would look again. Run each hour, which also sees a retirement dated for a later day come
 * round, and as one is retired. Opens no alert of its own.
 */
export async function closeStaleLowStock(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert; readonly now: () => Date },
): Promise<void> {
  const { results } = await db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND key >= 'low_stock:' AND key < 'low_stock;'")
    .all<{ key: string }>();
  await tellOfLowStock(db, deps, { touched: results.map(({ key }) => ofKey(key).place), lowered: [] });
}

/**
 * How many places hold something at or below its level, or below zero, by the rule the Stock screen marks them with
 * (src/domain/inventory/stock-view.ts): the console's Stock badge. A place is counted while it is active or holds
 * anything.
 */
export async function lowStockPlaces(db: D1Database, today: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS places FROM stock_places p
       WHERE (p.active = 1 OR EXISTS (SELECT 1 FROM stock_balances b WHERE b.place = p.id AND b.quantity <> 0))
         AND EXISTS (SELECT 1 FROM consumables c
           LEFT JOIN stock_balances b ON b.consumable_code = c.code AND b.place = p.id
           WHERE COALESCE(b.quantity, 0) < 0
             OR ((c.retired_date IS NULL OR c.retired_date > ?1) AND COALESCE(b.quantity, 0) <=
               CASE p.kind WHEN 'kit' THEN c.reorder_kit WHEN 'warehouse' THEN c.reorder_central
                 ELSE c.reorder_store END))`,
    )
    .bind(today)
    .first<{ places: number }>();
  return row?.places ?? 0;
}
