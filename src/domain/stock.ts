// Stock of consumables, in each technician's kit and the central store
// (docs/decisions/0087-consumables-and-stock.md; the rules are src/policy/stock.ts).
//
// Every movement is a row of stock_movements, written with its audit entry in
// one batch, and never changed; what a place holds is the sum of its rows. Ops
// record deliveries into the central store, transfers between the store and a
// kit, counts, which write the difference from what the rows said, and
// losses. A job's use comes out of the kit of the technician who recorded it,
// as his consumables step lands, once however often the step is replayed
// (src/domain/job-use.ts).
//
// That sum is kept in stock_balances, a row for each consumable at each place,
// which the database moves in the same statement as each row of the ledger is
// written (migration 0053), so what a place holds is read without its history.
// It names the central store 'central', and a kit by its technician's ID.
//
// A place that falls to a consumable's reorder level raises one alert, for
// that kit or for the store, listing everything low there, and the Stock
// screen marks it. The alert closes when the place is stocked again.

import { indiaDate } from "../lib/india-time.ts";
import { countDifference, isLow } from "../policy/stock.ts";
import { auditStatement, auditStatementIfWritten, type AuditActor } from "./audit.ts";
import { allConsumables, isOffered, type Consumable } from "./consumables.ts";
import { isWithin } from "./places.ts";

/** Where stock is kept: a technician's kit, by his ID, or the central store, null. */
export type Place = string | null;

/** Why a row moved stock: a delivery, a transfer, a job's use, a count's difference, or a loss. */
export const MOVEMENT_REASONS = ["received", "transferred", "used", "counted", "written_off"] as const;
type Reason = (typeof MOVEMENT_REASONS)[number];

/** What ops write, with who and why, so every movement lands with its audit entry. */
export interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** A movement written, or the fields refused. `lowered` names the places whose stock went down. */
export type Moved =
  { readonly ok: true; readonly lowered: readonly Place[] } | { readonly ok: false; readonly fields: string[] };

const where = (place: Place) => (place === null ? "central" : "kit");

/** One row of the ledger, ready to write. */
interface Movement {
  readonly code: string;
  readonly place: Place;
  readonly quantity: number;
  readonly reason: Reason;
  readonly transferId?: string;
  readonly note: string | null;
}

const MOVEMENT_COLUMNS =
  "id, consumable_code, location, technician_id, quantity, reason, transfer_id, actor_kind, actor, note, created_at";

/** The row's values, `?1` to `?11`: its consumable is `?2` and its place `?4`. */
function movementValues(id: string, movement: Movement, written: Written) {
  return [
    id,
    movement.code,
    where(movement.place),
    movement.place,
    movement.quantity,
    movement.reason,
    movement.transferId ?? null,
    written.actor.kind,
    written.actor.id,
    movement.note,
    written.now.toISOString(),
  ];
}

function movementStatement(db: D1Database, movement: Movement, written: Written): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO stock_movements (${MOVEMENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
    .bind(...movementValues(crypto.randomUUID(), movement, written));
}

/** What a place, `?4`, holds of a consumable, `?2`, as a statement about one movement reads it. */
const HELD_THERE = `SELECT COALESCE((SELECT quantity FROM stock_balances
  WHERE consumable_code = ?2 AND place = COALESCE(?4, 'central')), 0)`;

/**
 * A count's row, `id`, written only while the place still holds what the count was worked out from. It answers the
 * row's ID when it is written: D1's count of changes takes in the balance a trigger moves with it.
 */
function countStatement(
  db: D1Database,
  id: string,
  movement: Movement,
  held: number,
  written: Written,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO stock_movements (${MOVEMENT_COLUMNS})
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE (${HELD_THERE}) = ?12
       RETURNING id`,
    )
    .bind(...movementValues(id, movement, written), held);
}

async function consumableExists(db: D1Database, code: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM consumables WHERE code = ?1").bind(code).first()) !== null;
}

/** A kit is a technician's, active or not: one who left may still hold stock to hand back. */
async function placeExists(db: D1Database, place: Place): Promise<boolean> {
  if (place === null) return true;
  return (await db.prepare("SELECT 1 FROM technicians WHERE id = ?1").bind(place).first()) !== null;
}

/** What a place holds of one consumable: the sum of its rows, as its balance keeps it. */
export async function heldOf(db: D1Database, code: string, place: Place): Promise<number> {
  const row = await db
    .prepare("SELECT quantity FROM stock_balances WHERE consumable_code = ?1 AND place = COALESCE(?2, 'central')")
    .bind(code, place)
    .first<{ quantity: number }>();
  return row?.quantity ?? 0;
}

/** Stock received into the central store. */
export async function receive(
  db: D1Database,
  input: { readonly code: string; readonly quantity: number; readonly note: string | null },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  await db.batch([
    auditStatement(db, entry("stock.receive", input.code, written, { quantity: input.quantity }), written.now),
    movementStatement(db, { ...input, place: null, reason: "received" }, written),
  ]);
  return { ok: true, lowered: [] };
}

/** Stock moved from one place to another: two rows, out of the one and into the other. */
export async function transfer(
  db: D1Database,
  input: { readonly code: string; readonly quantity: number; readonly from: Place; readonly to: Place },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  if (!(await placeExists(db, input.from))) return { ok: false, fields: ["from"] };
  if (input.from === input.to || !(await placeExists(db, input.to))) return { ok: false, fields: ["to"] };
  const transferId = crypto.randomUUID();
  await db.batch([
    auditStatement(
      db,
      entry("stock.transfer", input.code, written, {
        quantity: input.quantity,
        from: input.from ?? "central",
        to: input.to ?? "central",
      }),
      written.now,
    ),
    movementStatement(
      db,
      { code: input.code, place: input.from, quantity: -input.quantity, reason: "transferred", transferId, note: null },
      written,
    ),
    movementStatement(
      db,
      { code: input.code, place: input.to, quantity: input.quantity, reason: "transferred", transferId, note: null },
      written,
    ),
  ]);
  return { ok: true, lowered: [input.from] };
}

interface Counted {
  readonly code: string;
  readonly place: Place;
  readonly counted: number;
  readonly note: string | null;
}

/**
 * How often a count reads its place again when stock moved there between its
 * read and its write. Each try loses only to a movement landing in the same
 * moment, so a third is never expected to be needed.
 */
const COUNT_TRIES = 3;

/**
 * What ops counted at a place. The row is the difference from what the ledger
 * said, nought when they agree, so the ledger then holds exactly what was
 * counted and says when it was last counted.
 *
 * The difference is written only while the place still holds what it was
 * worked out from: a job's use landing between the read and the write would
 * otherwise be taken twice, once by its own row and once in the difference.
 * The place is then read again, and the count worked out afresh.
 */
export async function count(db: D1Database, input: Counted, written: Written): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  if (!(await placeExists(db, input.place))) return { ok: false, fields: ["technician_id"] };
  for (let tries = 0; tries < COUNT_TRIES; tries += 1) {
    const held = await heldOf(db, input.code, input.place);
    const difference = countDifference(input.counted, held);
    if (await writeCount(db, input, { held, difference }, written)) {
      return { ok: true, lowered: difference < 0 ? [input.place] : [] };
    }
  }
  throw new Error(`the stock of ${input.code} moved each time it was counted`);
}

/** The count's row and its audit entry, or neither if the place no longer holds `held`; whether they were written. */
async function writeCount(
  db: D1Database,
  input: Counted,
  found: { readonly held: number; readonly difference: number },
  written: Written,
): Promise<boolean> {
  const id = crypto.randomUUID();
  const movement: Movement = {
    code: input.code,
    place: input.place,
    quantity: found.difference,
    reason: "counted",
    note: input.note,
  };
  const detail = { place: input.place ?? "central", counted: input.counted, ...found };
  const [row] = await db.batch([
    countStatement(db, id, movement, found.held, written),
    auditStatementIfWritten(db, entry("stock.count", input.code, written, detail), written.now, {
      table: "stock_movements",
      id,
    }),
  ]);
  return row?.results.length === 1;
}

/** A loss somebody saw at a place, with what happened: a tube dropped, a batch spoilt. */
export async function writeOff(
  db: D1Database,
  input: { readonly code: string; readonly place: Place; readonly quantity: number; readonly note: string },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  if (!(await placeExists(db, input.place))) return { ok: false, fields: ["technician_id"] };
  await db.batch([
    auditStatement(
      db,
      entry("stock.write_off", input.code, written, { place: input.place ?? "central", quantity: input.quantity }),
      written.now,
    ),
    movementStatement(
      db,
      { code: input.code, place: input.place, quantity: -input.quantity, reason: "written_off", note: input.note },
      written,
    ),
  ]);
  return { ok: true, lowered: [input.place] };
}

function entry(
  action: "stock.receive" | "stock.transfer" | "stock.count" | "stock.write_off",
  code: string,
  written: Written,
  detail: Record<string, string | number>,
) {
  return {
    surface: "ops" as const,
    actor: written.actor,
    action,
    subject: { kind: "consumable", id: code },
    requestId: written.requestId,
    detail,
  };
}

export { tellOfLowStock } from "./low-stock.ts";

// ---------------------------------------------------------------------------
// What the Stock screen reads
// ---------------------------------------------------------------------------

export interface StockPlace {
  readonly technicianId: string | null;
  /** The technician's name; null for the central store, which the console names. */
  readonly name: string | null;
  readonly active: boolean;
}

export interface Holding {
  readonly code: string;
  readonly technicianId: string | null;
  readonly quantity: number;
  readonly low: boolean;
  /** When this place last counted it; null if never. */
  readonly countedAt: string | null;
}

export interface StockMovement {
  readonly at: string;
  readonly code: string;
  readonly technicianId: string | null;
  readonly quantity: number;
  readonly reason: Reason;
  /** An e-mail for ops, the technician's ID for a job's use. */
  readonly by: string;
  readonly note: string | null;
}

export interface StockView {
  /** Every consumable offered, and any retired one a place still holds. */
  readonly consumables: readonly Consumable[];
  /** The central store first, then every active technician's kit, and any other kit still holding stock. */
  readonly places: readonly StockPlace[];
  readonly holdings: readonly Holding[];
  /** The latest movements, newest first. */
  readonly movements: readonly StockMovement[];
}

interface TechnicianRow {
  readonly id: string;
  readonly name: string;
  readonly active: number;
}

/**
 * The places the screen shows: the central store where the caller reaches everywhere, then each kit within reach. A
 * technician who left keeps his column while his kit holds anything, so it can be counted or moved.
 */
function placesShown(
  technicians: readonly TechnicianRow[],
  holding: readonly { readonly technician_id: string | null }[],
  kits: ReadonlySet<string> | null,
): StockPlace[] {
  const store: StockPlace[] = kits === null ? [{ technicianId: null, name: null, active: true }] : [];
  const shown = technicians.filter(
    (row) => isWithin(kits, row.id) && (row.active === 1 || holding.some((each) => each.technician_id === row.id)),
  );
  return [...store, ...shown.map((row) => ({ technicianId: row.id, name: row.name, active: row.active === 1 }))];
}

/** How many of the latest movements the screen shows beneath the table. */
const MOVEMENTS_SHOWN = 30;

type BalanceRow = {
  consumable_code: string;
  technician_id: string | null;
  quantity: number;
  counted_at: string | null;
};
type MovementRow = {
  created_at: string;
  consumable_code: string;
  technician_id: string | null;
  quantity: number;
  reason: Reason;
  actor: string;
  note: string | null;
};

/**
 * What the places hold. `kits` are the technicians whose kits the caller's cities reach; null reaches every kit and the
 * central store, which is in no city.
 */
export async function stockView(
  db: D1Database,
  now: Date,
  kits: ReadonlySet<string> | null = null,
): Promise<StockView> {
  const today = indiaDate(now);
  const [balances, technicians, recent] = await Promise.all([
    db
      .prepare(
        `SELECT consumable_code, NULLIF(place, 'central') AS technician_id, quantity, counted_at FROM stock_balances`,
      )
      .all<BalanceRow>(),
    db
      .prepare(
        `SELECT id, name, active FROM technicians
         WHERE active = 1 OR id IN (SELECT place FROM stock_balances WHERE quantity <> 0)
         ORDER BY name`,
      )
      .all<TechnicianRow>(),
    db
      .prepare(
        `SELECT created_at, consumable_code, technician_id, quantity, reason, actor, note FROM stock_movements
         WHERE ?2 IS NULL OR technician_id IN (SELECT value FROM json_each(?2))
         ORDER BY created_at DESC, rowid DESC LIMIT ?1`,
      )
      .bind(MOVEMENTS_SHOWN, kits === null ? null : JSON.stringify([...kits]))
      .all<MovementRow>(),
  ]);
  const held = balances.results.filter((row) => isWithin(kits, row.technician_id));
  const holding = held.filter((row) => row.quantity !== 0);
  const heldSomewhere = new Set(holding.map((row) => row.consumable_code));
  const consumables = (await allConsumables(db)).filter(
    (consumable) => isOffered(consumable, today) || heldSomewhere.has(consumable.code),
  );
  const places = placesShown(technicians.results, holding, kits);

  const holdings = consumables.flatMap((consumable) =>
    places.map((place): Holding => {
      const row = held.find(
        (each) => each.consumable_code === consumable.code && each.technician_id === place.technicianId,
      );
      const quantity = row?.quantity ?? 0;
      const level = place.technicianId === null ? consumable.reorderCentral : consumable.reorderKit;
      return {
        code: consumable.code,
        technicianId: place.technicianId,
        quantity,
        low: isOffered(consumable, today) && isLow(quantity, level),
        countedAt: row?.counted_at ?? null,
      };
    }),
  );

  const movements = recent.results.map((row) => ({
    at: row.created_at,
    code: row.consumable_code,
    technicianId: row.technician_id,
    quantity: row.quantity,
    reason: row.reason,
    by: row.actor,
    note: row.note,
  }));
  return { consumables, places, holdings, movements };
}
