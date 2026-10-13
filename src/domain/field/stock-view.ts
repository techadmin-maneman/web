// What the Stock screen reads (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md): every place
// within reach, what each holds of each consumable from its balance, which is low, the lots each holds, and the
// latest movements. The movements themselves are written by src/domain/field/stock.ts.

import { indiaDate } from "../../lib/india-time.ts";
import { isLow, levelAt } from "../../policy/stock.ts";
import { allConsumables, isOffered, type Consumable } from "./consumables.ts";
import type { Reason } from "./stock.ts";
import { heldLots, type HeldLot } from "./stock-lots.ts";
import { allPlaces, isPlaceWithin, WAREHOUSE, type Place, type StockPlace } from "./stock-places.ts";

interface Holding {
  readonly code: string;
  readonly place: Place;
  readonly quantity: number;
  readonly low: boolean;
  /** When this place last counted it; null if never. */
  readonly countedAt: string | null;
  /** The lots it holds some of, soonest to expire first. */
  readonly lots: readonly HeldLot[];
}

interface StockMovement {
  readonly at: string;
  readonly code: string;
  readonly place: Place;
  readonly quantity: number;
  readonly reason: Reason;
  /** An e-mail for ops, the technician's ID for a job's use. */
  readonly by: string;
  readonly note: string | null;
}

interface StockView {
  /** Every consumable offered, and any retired one a place still holds. */
  readonly consumables: readonly Consumable[];
  /** Every open place within reach down the tree, and any closed one still holding stock. */
  readonly places: readonly StockPlace[];
  readonly holdings: readonly Holding[];
  /** The latest movements, newest first. */
  readonly movements: readonly StockMovement[];
}

/** How many of the latest movements the screen holds beneath the table, to sort and narrow there. */
const MOVEMENTS_SHOWN = 500;

type BalanceRow = {
  consumable_code: string;
  place: string;
  quantity: number;
  counted_at: string | null;
};
type MovementRow = {
  created_at: string;
  consumable_code: string;
  place: string;
  quantity: number;
  reason: Reason;
  actor: string;
  note: string | null;
};

/** A movement's place, as the balances name it. */
const ROW_PLACE = `COALESCE(m.place_id, m.technician_id, '${WAREHOUSE}')`;

/**
 * What the places hold. `within` are the places the caller's cities reach (src/domain/field/stock-places.ts); null
 * reaches every one. A kit of a technician who left, or a closed stockroom, keeps its column while it holds anything,
 * so it can be counted or emptied.
 */
export async function stockView(
  db: D1Database,
  now: Date,
  within: ReadonlySet<Place> | null = null,
): Promise<StockView> {
  const today = indiaDate(now);
  const [balances, every, recent, lots] = await Promise.all([
    db.prepare("SELECT consumable_code, place, quantity, counted_at FROM stock_balances").all<BalanceRow>(),
    allPlaces(db),
    db
      .prepare(
        // A service token by its label on the Staff list, as Activity names it.
        `SELECT m.created_at, m.consumable_code, ${ROW_PLACE} AS place, m.quantity, m.reason, m.note,
           COALESCE((SELECT label FROM staff_service_tokens WHERE client_id = m.actor), m.actor) AS actor
         FROM stock_movements m
         WHERE ?2 IS NULL OR ${ROW_PLACE} IN (SELECT value FROM json_each(?2))
         ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?1`,
      )
      .bind(MOVEMENTS_SHOWN, within === null ? null : JSON.stringify([...within]))
      .all<MovementRow>(),
    heldLots(db),
  ]);
  const held = balances.results.filter((row) => isPlaceWithin(within, row.place));
  const holding = held.filter((row) => row.quantity !== 0);
  const heldSomewhere = new Set(holding.map((row) => row.consumable_code));
  const consumables = (await allConsumables(db)).filter(
    (consumable) => isOffered(consumable, today) || heldSomewhere.has(consumable.code),
  );
  const places = every.filter(
    (place) => isPlaceWithin(within, place.id) && (place.active || holding.some((each) => each.place === place.id)),
  );

  const holdings = consumables.flatMap((consumable) =>
    places.map((place): Holding => {
      const row = held.find((each) => each.consumable_code === consumable.code && each.place === place.id);
      const quantity = row?.quantity ?? 0;
      const level = levelAt(consumable, place.kind);
      return {
        code: consumable.code,
        place: place.id,
        quantity,
        low: isOffered(consumable, today) && isLow(quantity, level),
        countedAt: row?.counted_at ?? null,
        lots: lots.filter((lot) => lot.code === consumable.code && lot.place === place.id),
      };
    }),
  );

  const movements = recent.results.map((row) => ({
    at: row.created_at,
    code: row.consumable_code,
    place: row.place,
    quantity: row.quantity,
    reason: row.reason,
    by: row.actor,
    note: row.note,
  }));
  return { consumables, places, holdings, movements };
}
