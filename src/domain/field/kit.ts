// A technician's kit, as their app shows it (docs/decisions/0164-the-kit-screen.md): what it holds of each item, by lot
// soonest to expire first, with its labelled pieces; what is on its way to it, to receive by scanning; and the pieces
// that came off, held as returned until handed back. Never a cost: technicians never see one.
//
// Handing back sends a kit's expired stock to the place it hangs from, in transit until that place receives it, and
// marks each returned piece handed in there, its unit with it.

import { auditStatement } from "../ops/audit.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { placeById, WAREHOUSE, type Place } from "./stock-places.ts";
import { sendStock } from "./stock-transit.ts";
import { kitUnits } from "./stock-units.ts";
import type { Written } from "./stock.ts";

interface KitLot {
  readonly lotCode: string;
  readonly expiresOn: string | null;
  readonly quantity: number;
}

interface KitItem {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity: number;
  readonly hairSystem: boolean;
  readonly lots: readonly KitLot[];
  /** Its pieces the kit holds labelled, of a hair system. */
  readonly units: readonly {
    readonly code: string;
    readonly lotCode: string | null;
    readonly expiresOn: string | null;
  }[];
}

interface Coming {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity: number;
  readonly from: string;
  readonly sentAt: string;
  /** The labels of a hair system's pieces on their way. */
  readonly units: readonly string[];
}

interface Returned {
  readonly pieceCode: string;
  readonly returnedAt: string;
  readonly reason: string | null;
}

export interface KitView {
  readonly held: readonly KitItem[];
  readonly coming: readonly Coming[];
  readonly returned: readonly Returned[];
}

type HeldRow = { consumable_code: string; name: string; unit: string; quantity: number; hair_system: number };
type LotRow = { code: string; lot_code: string; expires_on: string | null; quantity: number };
type ComingRow = {
  id: string;
  consumable_code: string;
  name: string;
  unit: string;
  quantity: number;
  from_name: string | null;
  from_place: string;
  sent_at: string;
};

/** What a kit holds, what is coming to it, and its pieces to hand back. */
export async function kitView(db: D1Database, kit: Place): Promise<KitView> {
  const [held, lots, units, coming, returned] = await Promise.all([
    db
      .prepare(
        `SELECT b.consumable_code, c.name, c.unit, b.quantity,
           EXISTS (SELECT 1 FROM hair_systems h WHERE h.code = b.consumable_code) AS hair_system
         FROM stock_balances b JOIN consumables c ON c.code = b.consumable_code
         WHERE b.place = ?1 AND b.quantity <> 0 ORDER BY c.name COLLATE NOCASE`,
      )
      .bind(kit)
      .all<HeldRow>(),
    db
      .prepare(
        `SELECT l.consumable_code AS code, l.lot_code, l.expires_on, b.quantity
         FROM stock_lot_balances b JOIN stock_lots l ON l.id = b.lot_id
         WHERE b.place = ?1 AND b.quantity > 0 ORDER BY l.expires_on IS NULL, l.expires_on, l.received_at`,
      )
      .bind(kit)
      .all<LotRow>(),
    kitUnits(db, kit),
    db
      .prepare(
        `SELECT t.id, t.consumable_code, c.name, c.unit, t.quantity, t.from_place, t.sent_at, p.name AS from_name
         FROM stock_transfers t JOIN consumables c ON c.code = t.consumable_code
         LEFT JOIN stock_places p ON p.id = t.from_place
         WHERE t.state = 'in_transit' AND t.to_place = ?1 ORDER BY t.sent_at`,
      )
      .bind(kit)
      .all<ComingRow>(),
    db
      .prepare(
        `SELECT piece_code, returned_at, reason FROM piece_returns INDEXED BY piece_returns_held
         WHERE technician_id = ?1 AND handed_in_at IS NULL ORDER BY returned_at`,
      )
      .bind(kit)
      .all<{ piece_code: string; returned_at: string; reason: string | null }>(),
  ]);
  const onTheWay = await unitsOnTheWay(
    db,
    coming.results.map((row) => row.id),
  );
  return {
    held: held.results.map((row) => ({
      code: row.consumable_code,
      name: row.name,
      unit: row.unit,
      quantity: row.quantity,
      hairSystem: row.hair_system === 1,
      lots: lots.results
        .filter((lot) => lot.code === row.consumable_code)
        .map((lot) => ({ lotCode: lot.lot_code, expiresOn: lot.expires_on, quantity: lot.quantity })),
      units: units
        .filter((unit) => unit.consumableCode === row.consumable_code)
        .map((unit) => ({ code: unit.code, lotCode: unit.lotCode, expiresOn: unit.expiresOn })),
    })),
    coming: coming.results.map((row) => ({
      id: row.id,
      code: row.consumable_code,
      name: row.name,
      unit: row.unit,
      quantity: row.quantity,
      from: row.from_name ?? row.from_place,
      sentAt: row.sent_at,
      units: onTheWay.get(row.id) ?? [],
    })),
    returned: returned.results.map((row) => ({
      pieceCode: row.piece_code,
      returnedAt: row.returned_at,
      reason: row.reason,
    })),
  };
}

/** The labels of the pieces each transfer carries, by transfer. */
async function unitsOnTheWay(db: D1Database, transfers: readonly string[]): Promise<Map<string, string[]>> {
  const onTheWay = new Map<string, string[]>();
  if (transfers.length === 0) return onTheWay;
  const { results } = await db
    .prepare(
      `SELECT transfer_id, code FROM stock_units INDEXED BY stock_units_by_transfer
       WHERE transfer_id IN (SELECT value FROM json_each(?1)) AND state = 'in_transit' ORDER BY serial`,
    )
    .bind(JSON.stringify(transfers))
    .all<{ transfer_id: string; code: string }>();
  for (const row of results) onTheWay.set(row.transfer_id, [...(onTheWay.get(row.transfer_id) ?? []), row.code]);
  return onTheWay;
}

/** What a technician hands back: returned pieces by their labels, and whether all the kit's expired stock goes too. */
interface HandedBack {
  readonly pieces: readonly string[];
  readonly expired: boolean;
}

/**
 * The pieces and expired stock handed back to the place the kit hangs from. Refused, naming `pieces`, where a label is
 * not of a piece the kit holds as returned.
 */
export async function handBack(
  db: D1Database,
  kit: Place,
  handed: HandedBack,
  written: Written,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly fields: string[] }> {
  const to = (await placeById(db, kit))?.parentId ?? WAREHOUSE;
  if (handed.pieces.length > 0) {
    const held = await db
      .prepare(
        `SELECT COUNT(*) AS held FROM piece_returns INDEXED BY piece_returns_held
         WHERE technician_id = ?1 AND handed_in_at IS NULL AND piece_code IN (SELECT value FROM json_each(?2))`,
      )
      .bind(kit, JSON.stringify(handed.pieces))
      .first<number>("held");
    if (held !== new Set(handed.pieces).size || held !== handed.pieces.length) return { ok: false, fields: ["pieces"] };
    await db.batch(piecesHandedIn(db, { kit, to, pieces: handed.pieces }, written));
  }
  if (handed.expired) {
    for (const lot of await expiredHeld(db, kit, indiaDate(written.now))) {
      await sendStock(db, { code: lot.code, quantity: lot.quantity, from: kit, to }, written);
    }
  }
  return { ok: true };
}

function piecesHandedIn(
  db: D1Database,
  moved: { readonly kit: Place; readonly to: Place; readonly pieces: readonly string[] },
  written: Written,
): D1PreparedStatement[] {
  const at = written.now.toISOString();
  const pieces = JSON.stringify(moved.pieces);
  return [
    auditStatement(
      db,
      {
        surface: "tech",
        actor: written.actor,
        action: "stock.hand_back",
        subject: { kind: "technician", id: moved.kit },
        requestId: written.requestId,
        detail: { pieces: moved.pieces.length, to: moved.to },
      },
      written.now,
    ),
    db
      .prepare(
        `UPDATE piece_returns SET handed_in_at = ?3, handed_in_to = ?4
         WHERE technician_id = ?1 AND handed_in_at IS NULL AND piece_code IN (SELECT value FROM json_each(?2))`,
      )
      .bind(moved.kit, pieces, at, moved.to),
    db
      .prepare(
        `INSERT INTO stock_unit_events (unit_id, at, state, place, actor)
         SELECT id, ?3, 'returned', ?4, ?5 FROM stock_units
         WHERE code IN (SELECT value FROM json_each(?2)) AND state = 'returned' AND place = ?1`,
      )
      .bind(moved.kit, pieces, at, moved.to, written.actor.id),
    db
      .prepare(
        `UPDATE stock_units SET place = ?4, moved_at = ?3
         WHERE code IN (SELECT value FROM json_each(?2)) AND state = 'returned' AND place = ?1`,
      )
      .bind(moved.kit, pieces, at, moved.to),
  ];
}

/**
 * Each stock code's expired stock a kit holds, recalled stock among it (docs/decisions/0187-recalls.md): what its lots
 * that expired before today or were recalled hold, at most its balance.
 */
async function expiredHeld(
  db: D1Database,
  kit: Place,
  today: string,
): Promise<{ readonly code: string; readonly quantity: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT l.consumable_code AS code,
         MIN(SUM(b.quantity), COALESCE((SELECT quantity FROM stock_balances
           WHERE consumable_code = l.consumable_code AND place = ?1), 0)) AS quantity
       FROM stock_lot_balances b JOIN stock_lots l ON l.id = b.lot_id
       WHERE b.place = ?1 AND b.quantity > 0 AND (l.expires_on < ?2 OR l.recalled_at IS NOT NULL)
       GROUP BY l.consumable_code`,
    )
    .bind(kit, today)
    .all<{ code: string; quantity: number }>();
  return results.filter((row) => row.quantity > 0);
}
