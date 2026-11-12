// The week's top-up (docs/decisions/0181-tomorrows-kits.md): on the evening ops set, the kit check looks a week ahead
// for consumables, at what each kit's visits over the next seven days are expected to use and its kit level on top,
// so a kit ends the week no lower than its level. Hair systems stay with tomorrow's check, which knows each client's.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import { tierOf } from "../../config/visit-types.ts";
import { bookedAhead } from "../../config/statuses.ts";
import { latestFits } from "../clients/hair-profiles.ts";

/** How many days from tomorrow the week's top-up covers. */
const TOP_UP_DAYS = 7;

type WeekRow = { kit: string; code: string; quantity: number; level: number };

/** Each active kit's consumables for the week from tomorrow: what its visits are expected to use, and its level. */
async function weeksUse(db: D1Database, tomorrow: string): Promise<WeekRow[]> {
  const { results } = await db
    .prepare(
      `WITH used AS (
         SELECT a.technician_id AS kit, u.consumable_code AS code, SUM(u.quantity) AS quantity
         FROM appointments a JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = ${tierOf("a.tier")}
         WHERE ${bookedAhead("a")} AND a.technician_id IS NOT NULL GROUP BY 1, 2)
       SELECT p.id AS kit, c.code, COALESCE(used.quantity, 0) AS quantity, COALESCE(c.reorder_kit, 0) AS level
       FROM stock_places p CROSS JOIN consumables c LEFT JOIN used ON used.kit = p.id AND used.code = c.code
       WHERE p.kind = 'kit' AND p.active = 1 AND (c.retired_date IS NULL OR c.retired_date > ?3)
         AND NOT EXISTS (SELECT 1 FROM hair_systems h WHERE h.code = c.code)
         AND (used.quantity IS NOT NULL OR c.reorder_kit IS NOT NULL)`,
    )
    .bind(
      indiaInstant(tomorrow, "00:00").toISOString(),
      indiaInstant(addDays(tomorrow, TOP_UP_DAYS), "00:00").toISOString(),
      tomorrow,
    )
    .all<WeekRow>();
  return results;
}

/**
 * Tomorrow's needs with the week's consumables in: each kit's need of a consumable at least its week's use and its
 * level. The level each adds, by kit and code, so the plan line shows it as the kit's safety stock.
 */
export async function addTheWeek(
  db: D1Database,
  needs: Map<string, Map<string, number>>,
  tomorrow: string,
): Promise<Map<string, number>> {
  const levels = new Map<string, number>();
  for (const row of await weeksUse(db, tomorrow)) {
    const kitNeeds = needs.get(row.kit) ?? new Map<string, number>();
    kitNeeds.set(row.code, Math.max(kitNeeds.get(row.code) ?? 0, row.quantity + row.level));
    needs.set(row.kit, kitNeeds);
    levels.set(`${row.kit} ${row.code}`, row.level);
  }
  return levels;
}

/** How many days the technician's own forecast looks ahead, today's included. */
const FORECAST_DAYS = 7;

/** A lot the kit holds, as the kit lists it (./kit.ts). */
interface HeldLot {
  readonly expiresOn: string | null;
  readonly quantity: number;
  /** In a recall (docs/decisions/0187-recalls.md): it goes back to ops, as an expired lot does. */
  readonly recalled: boolean;
}

/**
 * What the kit holds of an item fit to use: its count less its lots expired before `today` or recalled, as the kit
 * lists them, which go back to ops. Below nought where more was used than it held.
 */
export function usableOf(
  item: { readonly quantity: number; readonly lots: readonly HeldLot[] },
  today: string,
): number {
  const gone = item.lots
    .filter((lot) => lot.recalled || (lot.expiresOn !== null && lot.expiresOn < today))
    .reduce((sum, lot) => sum + lot.quantity, 0);
  return item.quantity - gone;
}

/** A consumable the kit's visits are expected to use over the forecast's days. */
interface WeekNeed {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly need: number;
}

/** The same, against what the kit holds of it fit to use. */
export interface WeekAhead extends WeekNeed {
  readonly have: number;
}

/**
 * The technician's own week ahead, for their Kit screen and an ask of ops: each consumable their visits booked from
 * today to six days on are expected to use, against what their kit holds of it fit to use, as the kit's own view counts
 * it (usableOf). Hair systems are left to the evening's check, as above.
 */
export async function weekAheadOf(
  db: D1Database,
  kit: string,
  today: string,
  view: { readonly held: readonly { readonly code: string; readonly usable: number }[] },
): Promise<WeekAhead[]> {
  const usable = new Map(view.held.map((item) => [item.code, item.usable]));
  return (await weekNeedOf(db, kit, today)).map((item) => ({
    ...item,
    have: Math.max(0, usable.get(item.code) ?? 0),
  }));
}

async function weekNeedOf(db: D1Database, kit: string, today: string): Promise<WeekNeed[]> {
  const { results } = await db
    .prepare(
      `SELECT u.consumable_code AS code, c.name, c.unit, SUM(u.quantity) AS need
         FROM appointments a INDEXED BY appointments_by_technician
         JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = ${tierOf("a.tier")}
         JOIN consumables c ON c.code = u.consumable_code
        WHERE a.technician_id = ?3 AND ${bookedAhead("a")}
          AND NOT EXISTS (SELECT 1 FROM hair_systems h WHERE h.code = u.consumable_code)
        GROUP BY u.consumable_code, c.name, c.unit
        ORDER BY c.name COLLATE NOCASE`,
    )
    .bind(
      indiaInstant(today, "00:00").toISOString(),
      indiaInstant(addDays(today, FORECAST_DAYS), "00:00").toISOString(),
      kit,
    )
    .all<WeekNeed>();
  return results;
}

/** A product's pieces the week's first fits and replacements need, against the kit's pieces of it fit to use. */
export interface PiecesAhead {
  readonly product: string;
  /** The product as its first fit is sold: "Mane Man Essential". */
  readonly name: string;
  readonly need: number;
  readonly have: number;
}

/** A first fit or a replacement in the week, as booked. */
interface FitBooked {
  readonly person_id: string;
  readonly type: string;
  readonly tier: string | null;
  readonly one_visit: string | null;
}

/**
 * The product each fit of the week needs a piece of, as the evening's check reads it (./kit-check.ts): a first fit's
 * the product it was booked as, a replacement's the client's own, from their hair profile. A consultation and fit in
 * one visit is left out, as its client chooses at the visit or not at all, and so is a replacement with no profile.
 */
async function piecesNeeded(db: D1Database, fits: readonly FitBooked[]): Promise<Map<string, number>> {
  const profiles = await latestFits(
    db,
    fits.filter((fit) => fit.type === "replacement").map((fit) => fit.person_id),
  );
  const need = new Map<string, number>();
  for (const fit of fits) {
    if (fit.one_visit !== null) continue;
    const product = fit.type === "first_fit" ? fit.tier : (profiles.get(fit.person_id)?.product ?? null);
    if (product !== null) need.set(product, (need.get(product) ?? 0) + 1);
  }
  return need;
}

/**
 * The technician's week ahead beyond consumables, for their Kit screen: how many visits are booked from today to six
 * days on, and for each product the pieces their first fits and replacements need, as the evening's check reads them,
 * against the pieces of it the kit holds fit to use. Shown only: an ask of ops stays with consumables, as the evening's
 * check, above, fits pieces to each client.
 */
export async function weekVisitsOf(
  db: D1Database,
  kit: string,
  today: string,
  view: { readonly held: readonly { readonly code: string; readonly usable: number; readonly hairSystem: boolean }[] },
): Promise<{ visits: number; pieces: PiecesAhead[] }> {
  const window = [
    indiaInstant(today, "00:00").toISOString(),
    indiaInstant(addDays(today, FORECAST_DAYS), "00:00").toISOString(),
    kit,
  ];
  const [visits, fits, products, names] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS visits FROM appointments a INDEXED BY appointments_by_technician
          WHERE a.technician_id = ?3 AND ${bookedAhead("a")}`,
      )
      .bind(...window)
      .first<{ visits: number }>(),
    db
      .prepare(
        `SELECT a.person_id, a.type, a.tier, a.one_visit FROM appointments a INDEXED BY appointments_by_technician
          WHERE a.technician_id = ?3 AND ${bookedAhead("a")} AND a.type IN ('first_fit', 'replacement')`,
      )
      .bind(...window)
      .all<FitBooked>(),
    db.prepare(`SELECT code, product FROM hair_systems`).all<{ code: string; product: string }>(),
    db.prepare(`SELECT tier, name FROM services WHERE kind = 'first_fit'`).all<{ tier: string; name: string }>(),
  ]);
  const productOf = new Map(products.results.map((row) => [row.code, row.product]));
  const have = new Map<string, number>();
  for (const item of view.held) {
    const product = item.hairSystem ? productOf.get(item.code) : undefined;
    if (product !== undefined) have.set(product, (have.get(product) ?? 0) + Math.max(0, item.usable));
  }
  const nameOf = new Map(names.results.map((row) => [row.tier, row.name]));
  const pieces = [...(await piecesNeeded(db, fits.results))].flatMap(([product, need]) => {
    // A product sold as no first fit names no piece.
    const name = nameOf.get(product);
    return name === undefined ? [] : [{ product, name, need, have: have.get(product) ?? 0 }];
  });
  return {
    visits: visits?.visits ?? 0,
    pieces: pieces.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
