// Stock of consumables at each place it is kept: the national warehouse, a zone's hub, a city's stockroom and each
// technician's kit (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md; the rules are
// src/policy/stock.ts, the places src/domain/field/stock-places.ts).
//
// Every movement is a row of stock_movements, written with its audit entry in
// one batch, and never changed; what a place holds is the sum of its rows. Ops
// record deliveries into the warehouse, transfers between any two places,
// counts, which write the difference from what the rows said, and losses. A job's use comes out of the kit of the technician who recorded it,
// as their consumables step lands, once however often the step is replayed
// (src/domain/field/job-use.ts).
//
// That sum is kept in stock_balances, a row for each consumable at each place,
// which the database moves in the same statement as each row of the ledger is
// written (migration 0053), so what a place holds is read without its history.
// It names each place by its ID: the warehouse WAREHOUSE, and a kit its technician's.
//
// Each movement is broken down by the lots it moved, soonest to expire first
// (src/domain/field/stock-lots.ts, docs/decisions/0157-lots-and-expiry.md).
//
// A place that falls to a consumable's reorder level raises one alert, for
// that place, listing everything low there, and the Stock screen marks it. A
// kit has the kit's level and every other place the central one. The alert
// closes when the place is stocked again.

import { indiaDate } from "../../lib/india-time.ts";
import { countDifference, isLow } from "../../policy/stock.ts";
import { auditStatement, auditStatementIfWritten, type AuditActor } from "../ops/audit.ts";
import { allConsumables, isOffered, type Consumable } from "./consumables.ts";
import { heldLots, lotMoves, receivedLotMoves, soonestFirst, type HeldLot, type ReceivedLot } from "./stock-lots.ts";
import {
  allPlaces,
  isPlaceWithin,
  placeById,
  WAREHOUSE,
  type Place,
  type PlaceKind,
  type StockPlace,
} from "./stock-places.ts";

/** Why a row moved stock: a delivery, a transfer, a job's use, a count's difference, or a loss. */
export const MOVEMENT_REASONS = ["received", "transferred", "used", "counted", "written_off"] as const;
type Reason = (typeof MOVEMENT_REASONS)[number];

/** What ops write, with who and why, so every movement lands with its audit entry. */
interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** A movement written, or the fields refused. `lowered` names the places whose stock went down. */
export type Moved =
  { readonly ok: true; readonly lowered: readonly Place[] } | { readonly ok: false; readonly fields: string[] };

/** One row of the ledger, ready to write. */
interface Movement {
  readonly code: string;
  readonly place: Place;
  readonly kind: PlaceKind;
  readonly quantity: number;
  readonly reason: Reason;
  readonly transferId?: string;
  readonly note: string | null;
}

const MOVEMENT_COLUMNS =
  "id, consumable_code, location, technician_id, quantity, reason, transfer_id, actor_kind, actor, note, created_at, place_id";

/**
 * The row's values, `?1` to `?12`: its consumable is `?2`. A kit's row names the technician in `?4`, a hub's or a
 * stockroom's names the place in `?12`, and the warehouse's leaves both null, as every row did before the tree.
 */
function movementValues(id: string, movement: Movement, written: Written) {
  const store = movement.kind === "hub" || movement.kind === "stockroom";
  return [
    id,
    movement.code,
    movement.kind === "kit" ? "kit" : "central",
    movement.kind === "kit" ? movement.place : null,
    movement.quantity,
    movement.reason,
    movement.transferId ?? null,
    written.actor.kind,
    written.actor.id,
    movement.note,
    written.now.toISOString(),
    store ? movement.place : null,
  ];
}

function movementStatement(
  db: D1Database,
  movement: Movement,
  written: Written,
  id: string = crypto.randomUUID(),
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO stock_movements (${MOVEMENT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(...movementValues(id, movement, written));
}

/** What the place of a movement's row holds of its consumable, `?2`, as a statement about the row reads it. */
const HELD_THERE = `SELECT COALESCE((SELECT quantity FROM stock_balances
  WHERE consumable_code = ?2 AND place = COALESCE(?12, ?4, '${WAREHOUSE}')), 0)`;

/**
 * A count's row, `id`, written only while the place still holds what the count was worked out from. It answers the
 * row's ID when it is written: D1's count of changes takes in the balance a trigger moves with it.
 */
function countStatement({
  db,
  id,
  movement,
  held,
  written,
}: {
  db: D1Database;
  id: string;
  movement: Movement;
  held: number;
  written: Written;
}): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO stock_movements (${MOVEMENT_COLUMNS})
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE (${HELD_THERE}) = ?13
       RETURNING id`,
    )
    .bind(...movementValues(id, movement, written), held);
}

async function consumableExists(db: D1Database, code: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM consumables WHERE code = ?1").bind(code).first()) !== null;
}

/** A place's kind, open or closed: a kit of a technician who left, or a closed stockroom, may still hold stock. */
async function kindOf(db: D1Database, place: Place): Promise<PlaceKind | null> {
  return (await placeById(db, place))?.kind ?? null;
}

/** What a place holds of one consumable: the sum of its rows, as its balance keeps it. */
async function heldOf(db: D1Database, code: string, place: Place): Promise<number> {
  const row = await db
    .prepare("SELECT quantity FROM stock_balances WHERE consumable_code = ?1 AND place = ?2")
    .bind(code, place)
    .first<{ quantity: number }>();
  return row?.quantity ?? 0;
}

/** Stock received into the warehouse, into the lot named, or of none (src/domain/field/stock-lots.ts). */
export async function receiveStock(
  db: D1Database,
  input: { readonly code: string; readonly quantity: number; readonly note: string | null; readonly lot?: ReceivedLot },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  const id = crypto.randomUUID();
  const lot = input.lot ?? { lotCode: null, expiresOn: null };
  const movement = { code: input.code, quantity: input.quantity, note: input.note };
  await db.batch([
    auditStatement(db, entry("stock.receive", input.code, written, { quantity: input.quantity }), written.now),
    movementStatement(db, { ...movement, place: WAREHOUSE, kind: "warehouse", reason: "received" }, written, id),
    ...(await receivedLotMoves(db, { code: input.code, lot, movementId: id, quantity: input.quantity }, written.now)),
  ]);
  return { ok: true, lowered: [] };
}

/** Stock moved from one place to another: two rows, out of the one and into the other. */
export async function transferStock(
  db: D1Database,
  input: { readonly code: string; readonly quantity: number; readonly from: Place; readonly to: Place },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  const fromKind = await kindOf(db, input.from);
  if (fromKind === null) return { ok: false, fields: ["from"] };
  const toKind = input.from === input.to ? null : await kindOf(db, input.to);
  if (toKind === null) return { ok: false, fields: ["to"] };
  const transferId = crypto.randomUUID();
  const [out, into] = [crypto.randomUUID(), crypto.randomUUID()];
  const moved = { code: input.code, reason: "transferred", transferId, note: null } as const;
  const takes = await soonestFirst(db, { code: input.code, place: input.from, quantity: input.quantity });
  await db.batch([
    auditStatement(
      db,
      entry("stock.transfer", input.code, written, { quantity: input.quantity, from: input.from, to: input.to }),
      written.now,
    ),
    movementStatement(db, { ...moved, place: input.from, kind: fromKind, quantity: -input.quantity }, written, out),
    movementStatement(db, { ...moved, place: input.to, kind: toKind, quantity: input.quantity }, written, into),
    ...lotMoves(db, { movementId: out, place: input.from, takes, sign: -1 }),
    ...lotMoves(db, { movementId: into, place: input.to, takes, sign: 1 }),
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
  const kind = await kindOf(db, input.place);
  if (kind === null) return { ok: false, fields: ["place_id"] };
  for (let tries = 0; tries < COUNT_TRIES; tries += 1) {
    const held = await heldOf(db, input.code, input.place);
    const difference = countDifference(input.counted, held);
    if (await writeCount(db, { ...input, kind }, { held, difference }, written)) {
      return { ok: true, lowered: difference < 0 ? [input.place] : [] };
    }
  }
  throw new Error(`the stock of ${input.code} moved each time it was counted`);
}

/** The count's row and its audit entry, or neither if the place no longer holds `held`; whether they were written. */
async function writeCount(
  db: D1Database,
  input: Counted & { readonly kind: PlaceKind },
  found: { readonly held: number; readonly difference: number },
  written: Written,
): Promise<boolean> {
  const id = crypto.randomUUID();
  const movement: Movement = {
    code: input.code,
    place: input.place,
    kind: input.kind,
    quantity: found.difference,
    reason: "counted",
    note: input.note,
  };
  const detail = { place: input.place, counted: input.counted, ...found };
  // Less counted than held leaves from the lots that expire soonest; more is of no known lot.
  const takes =
    found.difference < 0
      ? await soonestFirst(db, { code: input.code, place: input.place, quantity: -found.difference })
      : [];
  const [row] = await db.batch([
    countStatement({ db, id, movement, held: found.held, written }),
    auditStatementIfWritten(db, entry("stock.count", input.code, written, detail), written.now, {
      table: "stock_movements",
      id,
    }),
    ...lotMoves(db, { movementId: id, place: input.place, takes, sign: -1 }),
  ]);
  return row?.results.length === 1;
}

/**
 * A loss somebody saw at a place, with what happened: a tube dropped, a batch spoilt. It leaves from the lot named, as
 * one that expired, or from the lots that expire soonest.
 */
export async function writeOff(
  db: D1Database,
  input: {
    readonly code: string;
    readonly place: Place;
    readonly quantity: number;
    readonly note: string;
    readonly lotId?: string | null;
  },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  const kind = await kindOf(db, input.place);
  if (kind === null) return { ok: false, fields: ["place_id"] };
  const id = crypto.randomUUID();
  const takes = await soonestFirst(db, { ...input, lotId: input.lotId ?? null });
  if (input.lotId !== undefined && input.lotId !== null && takes.length === 0) return { ok: false, fields: ["lot_id"] };
  await db.batch([
    auditStatement(
      db,
      entry("stock.write_off", input.code, written, { place: input.place, quantity: input.quantity }),
      written.now,
    ),
    movementStatement(
      db,
      {
        code: input.code,
        place: input.place,
        kind,
        quantity: -input.quantity,
        reason: "written_off",
        note: input.note,
      },
      written,
      id,
    ),
    ...lotMoves(db, { movementId: id, place: input.place, takes, sign: -1 }),
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
      const level = place.kind === "kit" ? consumable.reorderKit : consumable.reorderCentral;
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
