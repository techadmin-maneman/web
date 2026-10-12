// Pieces as units (docs/decisions/0161-pieces-as-units.md): every hair system piece received at the warehouse is a
// unit with its own label, the code its QR holds, and each movement of a hair system moves the units it takes. The
// ledger still keeps the counts (src/domain/field/stock.ts); a unit says which piece is where, in which lot.
//
// A movement that names no units takes them soonest to expire first, as lots go (src/domain/field/stock-lots.ts), and
// of each lot the pieces held before labels first: a place may hold more pieces than units, never the other way. What
// a movement takes of each lot follows from the pieces it takes, so the lots and the units agree.
//
// Each unit's change is written in its movement's batch, only where that movement is, and its history only added to.

import { soonestFirst, type LotTake } from "./stock-lots.ts";
import type { Place } from "./stock-places.ts";

export const UNIT_STATES = ["held", "in_transit", "fitted", "returned", "written_off", "missing"] as const;
type UnitState = (typeof UNIT_STATES)[number];

/** The most pieces one delivery, or one labelling, labels. */
export const MAX_LABELLED = 500;

/** The letters a label's check letter is drawn from: no I or O, which read as digits, and no Z. */
const CHECK_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXY";

/**
 * A label: MM, the product's first three letters, a seven-digit serial and a check letter, the serial's remainder by
 * 23, which catches any one digit mistyped and any two side by side swapped. MM-STA-0000123-K.
 */
export function labelOf(segment: string, serial: number): string {
  return `MM-${segment}-${String(serial).padStart(7, "0")}-${CHECK_LETTERS.charAt(serial % CHECK_LETTERS.length)}`;
}

/** The same label, made in SQL from a segment and a serial. */
const labelSql = (segment: string, serial: string) =>
  `'MM-' || ${segment} || '-' || printf('%07d', ${serial}) || '-' || ` +
  `substr('${CHECK_LETTERS}', (${serial}) % ${String(CHECK_LETTERS.length)} + 1, 1)`;

/** A product's part of its pieces' labels: its first three letters or digits, in capitals; "standard" is STA. */
export const productSegment = (product: string): string =>
  product
    .replaceAll(/[^a-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(2, "X");

/** A lot's labels say LT, which no product's three letters do. */
const LOT_SEGMENT = "LT";

/** One piece a place holds, or a transfer carries: its lot, and its unit if it is labelled. */
interface Piece {
  readonly lotId: string | null;
  readonly unit: { readonly id: string; readonly code: string } | null;
}

/** What taking pieces gives: the units, and what it takes of each lot. */
export interface Taken {
  readonly units: readonly string[];
  readonly takes: readonly LotTake[];
}

export function takesOf(pieces: readonly { readonly lotId: string | null }[]): LotTake[] {
  const byLot = new Map<string, number>();
  for (const piece of pieces) if (piece.lotId !== null) byLot.set(piece.lotId, (byLot.get(piece.lotId) ?? 0) + 1);
  return [...byLot].map(([lotId, quantity]) => ({ lotId, quantity }));
}

const takenOf = (pieces: readonly Piece[]): Taken => ({
  units: pieces.flatMap((piece) => (piece.unit === null ? [] : [piece.unit.id])),
  takes: takesOf(pieces),
});

/** Which way a movement naming no units takes them: those never labelled first, or the labelled first. */
type Prefer = "unlabelled" | "labelled";

/**
 * Which `quantity` pieces go: the units named, every one of which must be there, or the first in line, those never
 * labelled first where `prefer` says so (a count that found fewer, a fit under a label we never made), or the
 * labelled first (what arrived of a transfer short).
 */
function pick(
  pieces: readonly Piece[],
  quantity: number,
  options: { readonly named?: readonly string[] | null; readonly prefer?: Prefer },
): Piece[] | null {
  const named = options.named ?? null;
  if (named !== null) {
    const chosen = named.map((code) => pieces.find((piece) => piece.unit?.code === code));
    if (new Set(named).size !== named.length) return null;
    return chosen.every((piece): piece is Piece => piece !== undefined) ? chosen : null;
  }
  const first = (piece: Piece) => (options.prefer === "unlabelled" ? piece.unit === null : piece.unit !== null);
  const line =
    options.prefer === undefined ? pieces : [...pieces.filter(first), ...pieces.filter((piece) => !first(piece))];
  return line.slice(0, quantity);
}

interface UnitRow {
  readonly id: string;
  readonly code: string;
  readonly lot_id: string | null;
}

/** A lot's pieces, or those of no lot: the ones never labelled, then its units. */
function lineOf(lotId: string | null, quantity: number, units: readonly UnitRow[]): Piece[] {
  const labelled = units.filter((unit) => unit.lot_id === lotId);
  const unlabelled = Math.max(0, quantity - labelled.length);
  return [
    ...Array.from({ length: unlabelled }, (): Piece => ({ lotId, unit: null })),
    ...labelled.map((unit): Piece => ({ lotId, unit: { id: unit.id, code: unit.code } })),
  ];
}

/** Pieces in the order they go: by lot, as the lots are given, those of no lot last. */
function piecesOf(total: number, lots: readonly { id: string; quantity: number }[], units: readonly UnitRow[]) {
  const inLots = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  return [...lots.flatMap((lot) => lineOf(lot.id, lot.quantity, units)), ...lineOf(null, total - inLots, units)];
}

const SOONEST_FIRST = "ORDER BY l.expires_on IS NULL, l.expires_on, l.received_at";

/** The pieces a place holds of a hair system, in the order they leave. */
async function piecesAt(db: D1Database, code: string, place: Place): Promise<Piece[]> {
  const [held, lots, units] = await Promise.all([
    db
      .prepare("SELECT quantity FROM stock_balances WHERE consumable_code = ?1 AND place = ?2")
      .bind(code, place)
      .first<number>("quantity"),
    db
      .prepare(
        `SELECT l.id, b.quantity FROM stock_lot_balances b JOIN stock_lots l ON l.id = b.lot_id
         WHERE b.place = ?1 AND l.consumable_code = ?2 AND b.quantity > 0 ${SOONEST_FIRST}`,
      )
      .bind(place, code)
      .all<{ id: string; quantity: number }>(),
    db
      .prepare(
        `SELECT id, code, lot_id FROM stock_units INDEXED BY stock_units_held
         WHERE place = ?1 AND consumable_code = ?2 AND state = 'held' ORDER BY labelled_at, serial`,
      )
      .bind(place, code)
      .all<UnitRow>(),
  ]);
  return piecesOf(held ?? 0, lots.results, units.results);
}

/** The product a hair system is sold as; null for a stock code that is not a hair system. */
export async function hairSystemProduct(db: D1Database, code: string): Promise<string | null> {
  return db.prepare("SELECT product FROM hair_systems WHERE code = ?1").bind(code).first<string>("product");
}

/**
 * What `quantity` of a stock code leaving a place takes: of a consumable, the lots that expire soonest, or the lot
 * named; of a hair system, its pieces, as the units named or in line. Null where a unit named is not held there.
 */
export async function takenFrom(
  db: D1Database,
  leaving: {
    readonly code: string;
    readonly place: Place;
    readonly quantity: number;
    readonly lotId?: string | null;
    readonly named?: readonly string[] | null;
    readonly prefer?: Prefer;
  },
): Promise<Taken | null> {
  if ((await hairSystemProduct(db, leaving.code)) === null) {
    if ((leaving.named ?? null) !== null) return null;
    return { units: [], takes: await soonestFirst(db, leaving) };
  }
  const pieces = await piecesAt(db, leaving.code, leaving.place);
  const lotId = leaving.lotId ?? null;
  const picked = pick(
    lotId === null ? pieces : pieces.filter((piece) => piece.lotId === lotId),
    leaving.quantity,
    leaving,
  );
  return picked === null ? null : takenOf(picked);
}

/** What arrives of a transfer: the units, what it brings of each lot, and the units lost on the way. */
interface Arriving extends Taken {
  readonly lost: readonly string[];
}

/**
 * What `arrived` of a hair system's transfer brings: the units named, or of the lots that left, soonest to expire first,
 * its units before the pieces never labelled, which are taken to be the ones lost on the way. Null where a unit named
 * is not one the transfer carries.
 */
export async function piecesArriving(
  db: D1Database,
  transfer: { readonly id: string; readonly quantity: number },
  arrived: number,
  named: readonly string[] | null = null,
): Promise<Arriving | null> {
  const [lots, units] = await Promise.all([
    db
      .prepare(
        `SELECT lm.lot_id AS id, -lm.quantity AS quantity FROM stock_movements m
         JOIN stock_lot_moves lm ON lm.movement_id = m.id JOIN stock_lots l ON l.id = lm.lot_id
         WHERE m.transfer_id = ?1 AND m.quantity < 0 ${SOONEST_FIRST}`,
      )
      .bind(transfer.id)
      .all<{ id: string; quantity: number }>(),
    db
      .prepare(
        `SELECT id, code, lot_id FROM stock_units INDEXED BY stock_units_by_transfer
         WHERE transfer_id = ?1 AND state = 'in_transit' ORDER BY labelled_at, serial`,
      )
      .bind(transfer.id)
      .all<UnitRow>(),
  ]);
  const picked = pick(piecesOf(transfer.quantity, lots.results, units.results), arrived, { named, prefer: "labelled" });
  if (picked === null) return null;
  const arriving = takenOf(picked);
  return { ...arriving, lost: units.results.map((unit) => unit.id).filter((id) => !arriving.units.includes(id)) };
}

/** A test a unit's change is written under, with its values; by default, that its movement is written. */
type Condition = { readonly sql: string; readonly binds: readonly (string | number | null)[] };

interface UnitChange {
  readonly units: readonly string[];
  readonly state: UnitState;
  /** Where it is now: the place holding it, or that one in transit is going to; null once it has left the stock. */
  readonly place: Place | null;
  readonly movementId: string | null;
  readonly transferId?: string;
  readonly appointmentId?: string;
  readonly at: string;
  readonly actor: string;
}

/** The units moved into a state, with a line of each one's history, written only where `when` holds. */
export function unitChanges(db: D1Database, change: UnitChange, when?: Condition): D1PreparedStatement[] {
  if (change.units.length === 0) return [];
  const condition =
    when ??
    (change.movementId === null
      ? { sql: "1", binds: [] }
      : { sql: "EXISTS (SELECT 1 FROM stock_movements WHERE id = ?)", binds: [change.movementId] });
  const ids = JSON.stringify(change.units);
  const transferId = change.transferId ?? null;
  const appointmentId = change.appointmentId ?? null;
  return [
    db
      .prepare(
        `UPDATE stock_units SET state = ?, place = ?, transfer_id = ?, appointment_id = COALESCE(?, appointment_id),
           moved_at = ?
         WHERE id IN (SELECT value FROM json_each(?)) AND ${condition.sql}`,
      )
      .bind(
        change.state,
        change.place,
        change.state === "in_transit" ? transferId : null,
        appointmentId,
        change.at,
        ids,
        ...condition.binds,
      ),
    db
      .prepare(
        `INSERT INTO stock_unit_events (unit_id, at, state, place, movement_id, transfer_id, appointment_id, actor)
         SELECT value, ?, ?, ?, ?, ?, ?, ? FROM json_each(?) WHERE ${condition.sql}`,
      )
      .bind(
        change.at,
        change.state,
        change.place,
        change.movementId,
        transferId,
        appointmentId,
        change.actor,
        ids,
        ...condition.binds,
      ),
  ];
}

/**
 * New units of a hair system, labelled now and held at a place: one for each ID given, each in the next free serial,
 * in the lot a delivery makes in the same batch (by its code) or the one given, only where the movement is written.
 */
export function newUnits(
  db: D1Database,
  made: {
    readonly ids: readonly string[];
    readonly code: string;
    readonly product: string;
    readonly place: Place;
    readonly lot: { readonly lotCode: string } | { readonly lotId: string | null };
    readonly movementId: string | null;
    readonly at: string;
    readonly actor: string;
  },
): D1PreparedStatement[] {
  if (made.ids.length === 0) return [];
  const [lotSql, lot] =
    "lotCode" in made.lot
      ? ["(SELECT id FROM stock_lots WHERE consumable_code = ?3 AND lot_code = ?7)", made.lot.lotCode]
      : ["?7", made.lot.lotId];
  const written = made.movementId === null ? "1" : "EXISTS (SELECT 1 FROM stock_movements WHERE id = ?6)";
  const ids = JSON.stringify(made.ids);
  return [
    db
      .prepare(
        `INSERT INTO stock_units (id, code, serial, consumable_code, lot_id, state, place, labelled_at, moved_at)
         SELECT j.value, ${labelSql("?2", "s.top + j.key + 1")}, s.top + j.key + 1, ?3, ${lotSql}, 'held', ?4, ?5, ?5
         FROM json_each(?1) j, (SELECT COALESCE(MAX(serial), 0) AS top FROM stock_units) s
         WHERE ${written}`,
      )
      .bind(ids, productSegment(made.product), made.code, made.place, made.at, made.movementId, lot),
    db
      .prepare(
        `INSERT INTO stock_unit_events (unit_id, at, state, place, movement_id, actor)
         SELECT value, ?2, 'held', ?3, ?4, ?5 FROM json_each(?1)
         WHERE EXISTS (SELECT 1 FROM stock_units WHERE id = value)`,
      )
      .bind(ids, made.at, made.place, made.movementId, made.actor),
  ];
}

/** A unit a place holds, to print its label. */
export interface HeldUnit {
  readonly code: string;
  readonly lotCode: string | null;
  readonly expiresOn: string | null;
  readonly labelledAt: string;
}

/** The units a place holds of a hair system, the latest labelled first, and how many pieces it holds unlabelled. */
export async function heldUnits(
  db: D1Database,
  code: string,
  place: Place,
): Promise<{ readonly units: HeldUnit[]; readonly unlabelled: number }> {
  const [units, pieces] = await Promise.all([
    db
      .prepare(
        `SELECT u.code, l.lot_code, l.expires_on, u.labelled_at
         FROM stock_units u INDEXED BY stock_units_held LEFT JOIN stock_lots l ON l.id = u.lot_id
         WHERE u.place = ?1 AND u.consumable_code = ?2 AND u.state = 'held'
         ORDER BY u.labelled_at DESC, u.serial`,
      )
      .bind(place, code)
      .all<{ code: string; lot_code: string | null; expires_on: string | null; labelled_at: string }>(),
    piecesAt(db, code, place),
  ]);
  return {
    units: units.results.map((row) => ({
      code: row.code,
      lotCode: row.lot_code,
      expiresOn: row.expires_on,
      labelledAt: row.labelled_at,
    })),
    unlabelled: pieces.filter((piece) => piece.unit === null).length,
  };
}

/**
 * Labels for up to `quantity` of the pieces a place held before labels, soonest to expire first, each in its lot.
 * Returns how many it labelled.
 */
export async function labelHeld(
  db: D1Database,
  input: { readonly code: string; readonly product: string; readonly place: Place; readonly quantity: number },
  written: { readonly at: string; readonly actor: string },
  audit: D1PreparedStatement,
): Promise<number> {
  const unlabelled = (await piecesAt(db, input.code, input.place))
    .filter((piece) => piece.unit === null)
    .slice(0, input.quantity);
  if (unlabelled.length === 0) return 0;
  const byLot = new Map<string | null, string[]>();
  for (const piece of unlabelled) byLot.set(piece.lotId, [...(byLot.get(piece.lotId) ?? []), crypto.randomUUID()]);
  await db.batch([
    audit,
    ...[...byLot].flatMap(([lotId, ids]) =>
      newUnits(db, { ...input, ...written, ids, lot: { lotId }, movementId: null }),
    ),
  ]);
  return unlabelled.length;
}

/** A lot's label, for its boxes: made the first time it is asked for, in the next free serial. */
export async function lotLabel(db: D1Database, lotId: string): Promise<string | null> {
  const next = "(SELECT COALESCE(MAX(label_serial), 0) + 1 FROM stock_lots)";
  await db
    .prepare(
      `UPDATE stock_lots SET label_serial = ${next}, label = ${labelSql(`'${LOT_SEGMENT}'`, next)}
       WHERE id = ?1 AND label IS NULL`,
    )
    .bind(lotId)
    .run();
  return db.prepare("SELECT label FROM stock_lots WHERE id = ?1").bind(lotId).first<string>("label");
}
/** A unit by its label, with its history, as a scan of the label finds it. */
export interface UnitFound {
  readonly code: string;
  readonly consumableCode: string;
  readonly lotCode: string | null;
  readonly expiresOn: string | null;
  readonly state: UnitState;
  readonly place: Place | null;
  /** Where it last was: its place, or the last place its history names. */
  readonly lastPlace: Place | null;
  readonly history: readonly {
    readonly at: string;
    readonly state: UnitState;
    readonly place: Place | null;
    readonly actor: string;
  }[];
}

/** The unit a label names, with every line of its history, oldest first; null for a label we never made. */
export async function unitFound(db: D1Database, label: string): Promise<UnitFound | null> {
  const unit = await db
    .prepare(
      `SELECT u.id, u.code, u.consumable_code, l.lot_code, l.expires_on, u.state, u.place
       FROM stock_units u LEFT JOIN stock_lots l ON l.id = u.lot_id WHERE u.code = ?1`,
    )
    .bind(label)
    .first<{
      id: string;
      code: string;
      consumable_code: string;
      lot_code: string | null;
      expires_on: string | null;
      state: UnitState;
      place: string | null;
    }>();
  if (unit === null) return null;
  const { results } = await db
    .prepare(
      `SELECT e.at, e.state, e.place,
         COALESCE((SELECT label FROM staff_service_tokens WHERE client_id = e.actor), e.actor) AS actor
       FROM stock_unit_events e WHERE e.unit_id = ?1 ORDER BY e.at, e.rowid`,
    )
    .bind(unit.id)
    .all<{ at: string; state: UnitState; place: string | null; actor: string }>();
  return {
    code: unit.code,
    consumableCode: unit.consumable_code,
    lotCode: unit.lot_code,
    expiresOn: unit.expires_on,
    state: unit.state,
    place: unit.place,
    lastPlace: unit.place ?? results.findLast((line) => line.place !== null)?.place ?? null,
    history: results,
  };
}
