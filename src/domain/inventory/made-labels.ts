// A piece fitted with no label on it (docs/decisions/0291-pieces-without-labels.md) is recorded under a label made
// for it from its visit, as our labels are made (./stock-units.ts): MM, NL for no label, a serial and its check letter.
// The same visit always makes the same one, so a step sent again records the same piece; one another visit's piece
// or a unit of stock carries already is passed over for the next. Ops may write it on the piece, or print it, later.
//
// With no label to read its expiry or its owner from, the piece taken from the kit is one the job card would offer:
// in date on the visit's day, never a unit kept for another client's order or of a recalled lot; a piece never labelled
// first, and a recalled lot's last, as every deduction takes it. A unit so taken carries the made label while it is
// fitted, and its own again if a correction puts it back.

import { sha256Hex } from "../../lib/hash.ts";
import { reservedForOthers } from "../purchasing/custom-orders.ts";
import { piecesLabelled } from "./pieces.ts";
import { recalledIn } from "./recalls.ts";
import type { Place } from "./stock-places.ts";
import { labelOf, labelSql, piecesAt, productSegment, takenOf, type Piece, type Taken } from "./stock-units.ts";

/** What a made label says in place of a product's three letters: no label was on the piece. */
const MADE = "NL";

/** The serials a made label is drawn from: seven digits, as a unit's label. */
const SERIALS = 10_000_000;

/** The most serials tried past the visit's own before giving up, which would take that many pieces made alike. */
const TRIES = 50;

/** Whether a unit of stock other than the one `visitId` fitted carries `label`. */
async function unitLabelled(db: D1Database, label: string, visitId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS held FROM stock_units WHERE code = ?1 AND appointment_id IS NOT ?2")
    .bind(label, visitId)
    .first<{ held: number }>();
  return row !== null;
}

/** The label a piece fitted on `visitId` with none on it is recorded under. */
export async function madeLabel(db: D1Database, visitId: string): Promise<string> {
  const start = Number.parseInt((await sha256Hex(visitId)).slice(0, 12), 16) % SERIALS;
  for (let step = 0; step < TRIES; step += 1) {
    const label = labelOf(MADE, (start + step) % SERIALS);
    const [held, unit] = await Promise.all([piecesLabelled(db, label), unitLabelled(db, label, visitId)]);
    if (held.every((piece) => piece.appointment_id === visitId) && !unit) return label;
  }
  throw new Error(`no made label is free near ${labelOf(MADE, start)}`);
}

/**
 * The pieces of a hair system a kit gives a fit with no label, and whether it holds some but none it may give: each is
 * past its date on `day`, or a unit kept for another client or of a recalled lot.
 */
export async function noLabelTake(
  db: D1Database,
  at: { readonly code: string; readonly kit: Place; readonly visitId: string; readonly day: string },
  quantity: number,
): Promise<{ readonly taken: Taken; readonly unfit: boolean }> {
  const [pieces, lots, kept, recalled] = await Promise.all([
    piecesAt(db, at.code, at.kit),
    db
      .prepare(
        `SELECT l.id, l.expires_on < ?3 AS past, l.recalled_at IS NOT NULL AS recalled
         FROM stock_lot_balances b JOIN stock_lots l ON l.id = b.lot_id
         WHERE b.place = ?1 AND l.consumable_code = ?2 AND b.quantity > 0`,
      )
      .bind(at.kit, at.code, at.day)
      .all<{ id: string; past: number | null; recalled: number }>(),
    reservedForOthers(db, at.kit, at.visitId),
    recalledIn(db, at.kit),
  ]);
  const pastLots = new Set(lots.results.filter((lot) => lot.past === 1).map((lot) => lot.id));
  const recalledLots = new Set(lots.results.filter((lot) => lot.recalled === 1).map((lot) => lot.id));
  const free = pieces.filter(
    (piece) => piece.unit === null || !(kept.has(piece.unit.code) || recalled.has(piece.unit.code)),
  );
  const inDate = free.filter((piece) => piece.lotId === null || !pastLots.has(piece.lotId));
  const ofRecalled = (piece: Piece) => piece.lotId !== null && recalledLots.has(piece.lotId);
  const sound = inDate.filter((piece) => !ofRecalled(piece));
  const line = [
    ...sound.filter((piece) => piece.unit === null),
    ...sound.filter((piece) => piece.unit !== null),
    ...inDate.filter(ofRecalled),
  ];
  return { taken: takenOf(line.slice(0, quantity)), unfit: pieces.length > 0 && inDate.length === 0 };
}

/**
 * Units back in the kit that carry a made label take their own again, their product's letters and their serial: only
 * those the same batch did put back, so a step another overtook changes nothing.
 */
export function ownLabelsBack(db: D1Database, units: readonly string[], product: string): D1PreparedStatement[] {
  if (units.length === 0) return [];
  return [
    db
      .prepare(
        `UPDATE stock_units SET code = ${labelSql("?1", "serial")}
         WHERE id IN (SELECT value FROM json_each(?2)) AND state = 'held' AND code LIKE 'MM-${MADE}-%'`,
      )
      .bind(productSegment(product), JSON.stringify(units)),
  ];
}
