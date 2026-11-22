// Lots and expiry (docs/decisions/0157-lots-and-expiry.md): a delivery brings a lot of a stock code, with the supplier's
// lot and the day it expires, and each movement is broken down by the lots it moved. What leaves a place leaves from
// the lot that expires soonest first, and what arrives by a transfer is of the lots that left the other place. Stock
// counted up, or moved before lots, is of no known lot, and stays in the ledger's balance without one.
//
// The breakdown is written in the movement's own batch, each row only where its movement is written, so a movement
// a conditional write leaves out leaves out its lots too.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { WAREHOUSE, type Place } from "./stock-places.ts";

/** What a movement takes of one lot, as a positive figure. */
export interface LotTake {
  readonly lotId: string;
  readonly quantity: number;
}

/** A lot a place holds some of, as the Stock page reads it. */
export interface HeldLot {
  readonly id: string;
  readonly code: string;
  readonly place: Place;
  readonly lotCode: string;
  readonly expiresOn: string | null;
  readonly quantity: number;
}

const HELD_LOTS = `SELECT l.id, l.consumable_code AS code, b.place, l.lot_code, l.expires_on, b.quantity
  FROM stock_lot_balances b JOIN stock_lots l ON l.id = b.lot_id`;

/** A recalled lot last of all (docs/decisions/0187-recalls.md); soonest to expire first, one with no expiry last, then the earliest received. */
const SOONEST_FIRST = "ORDER BY l.recalled_at IS NOT NULL, l.expires_on IS NULL, l.expires_on, l.received_at";

interface HeldLotRow {
  readonly id: string;
  readonly code: string;
  readonly place: string;
  readonly lot_code: string;
  readonly expires_on: string | null;
  readonly quantity: number;
}

const heldLotOf = (row: HeldLotRow): HeldLot => ({
  id: row.id,
  code: row.code,
  place: row.place,
  lotCode: row.lot_code,
  expiresOn: row.expires_on,
  quantity: row.quantity,
});

/** Every lot each place holds some of, soonest to expire first. */
export async function heldLots(db: D1Database): Promise<HeldLot[]> {
  const { results } = await db.prepare(`${HELD_LOTS} WHERE b.quantity > 0 ${SOONEST_FIRST}`).all<HeldLotRow>();
  return results.map(heldLotOf);
}

/**
 * What `quantity` of a stock code leaving a place takes of its lots: the one that expires soonest first, or the lot
 * named alone. What the lots hold less than is of no known lot.
 */
export async function soonestFirst(
  db: D1Database,
  taking: { readonly code: string; readonly place: Place; readonly quantity: number; readonly lotId?: string | null },
): Promise<LotTake[]> {
  const { results } = await db
    .prepare(
      `${HELD_LOTS} WHERE b.place = ?1 AND l.consumable_code = ?2 AND b.quantity > 0 AND (?3 IS NULL OR l.id = ?3)
       ${SOONEST_FIRST}`,
    )
    .bind(taking.place, taking.code, taking.lotId ?? null)
    .all<HeldLotRow>();
  const takes: LotTake[] = [];
  let left = taking.quantity;
  for (const lot of results) {
    if (left <= 0) break;
    const taken = Math.min(left, lot.quantity);
    takes.push({ lotId: lot.id, quantity: taken });
    left -= taken;
  }
  return takes;
}

/** A movement's breakdown by lot: each row written only where the movement is. `sign` is -1 for what leaves. */
export function lotMoves(
  db: D1Database,
  move: {
    readonly movementId: string;
    readonly place: Place;
    readonly takes: readonly LotTake[];
    readonly sign: 1 | -1;
  },
): D1PreparedStatement[] {
  return move.takes.map((take) =>
    db
      .prepare(
        `INSERT INTO stock_lot_moves (movement_id, lot_id, place, quantity)
         SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM stock_movements WHERE id = ?1)`,
      )
      .bind(move.movementId, take.lotId, move.place, move.sign * take.quantity),
  );
}

/** The lot a delivery is received into, as ops name it; with neither a lot nor an expiry, none. */
export interface ReceivedLot {
  readonly lotCode: string | null;
  readonly expiresOn: string | null;
}

/**
 * A delivery's lot and its breakdown: the lot made where its stock code has none of that name, from its expiry, or
 * the day received plus the stock code's shelf life. A delivery with no lot named, of a stock code that expires, is a
 * lot named for its day; one of a stock code that does not, and with no lot named, is of none. A count that found more
 * than was held puts it in its place's lot the same way (an opening count); the warehouse is a delivery's. Returns the
 * lot's code with the statements, for the units a hair system's delivery makes in it.
 */
export async function receivedLotMoves(
  db: D1Database,
  received: {
    readonly code: string;
    readonly lot: ReceivedLot;
    readonly movementId: string;
    readonly quantity: number;
    readonly place?: Place;
  },
  now: Date,
): Promise<{ readonly lotCode: string | null; readonly statements: D1PreparedStatement[] }> {
  const shelf = await db
    .prepare("SELECT shelf_life_days FROM consumables WHERE code = ?1")
    .bind(received.code)
    .first<number | null>("shelf_life_days");
  const today = indiaDate(now);
  const expiresOn = received.lot.expiresOn ?? (shelf === null ? null : addDays(today, shelf));
  const lotCode = received.lot.lotCode ?? (expiresOn === null ? null : `R-${today.replaceAll("-", "")}`);
  if (lotCode === null) return { lotCode, statements: [] };
  const statements = [
    db
      .prepare(
        `INSERT INTO stock_lots (id, consumable_code, lot_code, expires_on, received_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (consumable_code, lot_code) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), received.code, lotCode, expiresOn, now.toISOString()),
    db
      .prepare(
        `INSERT INTO stock_lot_moves (movement_id, lot_id, place, quantity)
         SELECT ?1, id, ?5, ?2 FROM stock_lots WHERE consumable_code = ?3 AND lot_code = ?4
           AND EXISTS (SELECT 1 FROM stock_movements WHERE id = ?1)`,
      )
      .bind(received.movementId, received.quantity, received.code, lotCode, received.place ?? WAREHOUSE),
  ];
  return { lotCode, statements };
}

/**
 * What a job's correction gives back to the kit, by the lots the job took from: the latest taken first, and of one
 * step's, the lot that expires last, so a step that took too much puts back what it took last.
 */
export async function givenBackToLots(
  db: D1Database,
  giving: { readonly jobId: string; readonly kit: Place; readonly code: string; readonly quantity: number },
): Promise<LotTake[]> {
  const { results } = await db
    .prepare(
      `SELECT lm.lot_id, -SUM(lm.quantity) AS taken FROM stock_lot_moves lm
       JOIN stock_movements m ON m.id = lm.movement_id JOIN stock_lots l ON l.id = lm.lot_id
       WHERE m.appointment_id = ?1 AND m.reason = 'used' AND m.consumable_code = ?2 AND lm.place = ?3
       GROUP BY lm.lot_id HAVING taken > 0
       ORDER BY MAX(m.created_at) DESC, l.expires_on IS NULL DESC, l.expires_on DESC`,
    )
    .bind(giving.jobId, giving.code, giving.kit)
    .all<{ lot_id: string; taken: number }>();
  const takes: LotTake[] = [];
  let left = giving.quantity;
  for (const lot of results) {
    if (left <= 0) break;
    const given = Math.min(left, lot.taken);
    takes.push({ lotId: lot.lot_id, quantity: given });
    left -= given;
  }
  return takes;
}
