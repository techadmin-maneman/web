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
// (src/domain/field/stock-lots.ts, docs/decisions/0157-lots-and-expiry.md), and
// a hair system's by the pieces it moved (src/domain/field/stock-units.ts).
//
// A place that falls to a consumable's reorder level raises one alert, for
// that place, listing everything low there, and the Stock screen marks it. A
// kit has the kit's level and every other place the central one. The alert
// closes when the place is stocked again. What the Stock screen reads is
// src/domain/field/stock-view.ts.

import { countDifference } from "../../policy/stock.ts";
import { auditStatement, auditStatementIfWritten, type AuditActor } from "../ops/audit.ts";
import { lotMoves, receivedLotMoves, type ReceivedLot } from "./stock-lots.ts";
import { placeById, WAREHOUSE, type Place, type PlaceKind } from "./stock-places.ts";
import { hairSystemProduct, MAX_LABELLED, newUnits, takenFrom, unitChanges } from "./stock-units.ts";

/** Why a row moved stock: a delivery, a transfer, a job's use, a count's difference, or a loss. */
export const MOVEMENT_REASONS = ["received", "transferred", "used", "counted", "written_off"] as const;
export type Reason = (typeof MOVEMENT_REASONS)[number];

/** What ops write, with who and why, so every movement lands with its audit entry. */
export interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** A movement written, or the fields refused. `lowered` names the places whose stock went down. */
export type Moved =
  { readonly ok: true; readonly lowered: readonly Place[] } | { readonly ok: false; readonly fields: string[] };

/** One row of the ledger, ready to write. */
export interface Movement {
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

export function movementStatement(
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

/**
 * movementStatement, written only while `condition` holds: an SQL test whose placeholders start at ?13, after the
 * row's own, as a transfer this request settled earlier in the same batch.
 */
export function movementStatementWhen(
  db: D1Database,
  row: { readonly movement: Movement; readonly id: string },
  written: Written,
  condition: { readonly sql: string; readonly binds: readonly (string | number | null)[] },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO stock_movements (${MOVEMENT_COLUMNS})
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE ${condition.sql}`,
    )
    .bind(...movementValues(row.id, row.movement, written), ...condition.binds);
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

export async function consumableExists(db: D1Database, code: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM consumables WHERE code = ?1").bind(code).first()) !== null;
}

/** A place's kind, open or closed: a kit of a technician who left, or a closed stockroom, may still hold stock. */
export async function kindOf(db: D1Database, place: Place): Promise<PlaceKind | null> {
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

/**
 * Stock received into the warehouse, into the lot named, or of none (src/domain/field/stock-lots.ts). A hair system's
 * pieces are each labelled as they arrive, so one delivery of them is at most MAX_LABELLED.
 */
export async function receiveStock(
  db: D1Database,
  input: { readonly code: string; readonly quantity: number; readonly note: string | null; readonly lot?: ReceivedLot },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  const product = await hairSystemProduct(db, input.code);
  if (product !== null && input.quantity > MAX_LABELLED) return { ok: false, fields: ["quantity"] };
  const id = crypto.randomUUID();
  const lot = input.lot ?? { lotCode: null, expiresOn: null };
  const movement = { code: input.code, quantity: input.quantity, note: input.note };
  const received = await receivedLotMoves(
    db,
    { code: input.code, lot, movementId: id, quantity: input.quantity },
    written.now,
  );
  const units = Array.from({ length: product === null ? 0 : input.quantity }, () => crypto.randomUUID());
  await db.batch([
    auditStatement(db, entry("stock.receive", input.code, written, { quantity: input.quantity }), written.now),
    movementStatement(db, { ...movement, place: WAREHOUSE, kind: "warehouse", reason: "received" }, written, id),
    ...received.statements,
    ...newUnits(db, {
      ids: units,
      code: input.code,
      product: product ?? "",
      place: WAREHOUSE,
      lot: received.lotCode === null ? { lotId: null } : { lotCode: received.lotCode },
      movementId: id,
      ...unitWritten(written),
    }),
  ]);
  return { ok: true, lowered: [] };
}

/** When and by whom a unit's change is written. */
export const unitWritten = (written: Written) => ({ at: written.now.toISOString(), actor: written.actor.id });

/** What a movement out of a place moves: `quantity` of a stock code, or of a hair system the units named. */
export interface Moving {
  readonly code: string;
  readonly quantity: number;
  readonly from: Place;
  readonly to: Place;
  readonly units?: readonly string[] | null;
  /** To a kit: it arrives only once the technician scans it in, as any other place receives a transfer. */
  readonly waitForScan?: boolean;
}

/** Stock moved from one place to another: two rows, out of the one and into the other. */
export async function transferStock(db: D1Database, input: Moving, written: Written): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  const fromKind = await kindOf(db, input.from);
  if (fromKind === null) return { ok: false, fields: ["from"] };
  const toKind = input.from === input.to ? null : await kindOf(db, input.to);
  if (toKind === null) return { ok: false, fields: ["to"] };
  const transferId = crypto.randomUUID();
  const [out, into] = [crypto.randomUUID(), crypto.randomUUID()];
  const moved = { code: input.code, reason: "transferred", transferId, note: null } as const;
  const taken = await takenFrom(db, { ...input, place: input.from, named: input.units ?? null });
  if (taken === null) return { ok: false, fields: ["units"] };
  const takes = taken.takes;
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
    ...unitChanges(db, {
      units: taken.units,
      state: "held",
      place: input.to,
      movementId: into,
      ...unitWritten(written),
    }),
  ]);
  return { ok: true, lowered: [input.from] };
}

interface Counted {
  readonly code: string;
  readonly place: Place;
  readonly counted: number;
  readonly note: string | null;
  /** The lot any more found than was held is of, as at an opening count; none puts it in no known lot. */
  readonly lot?: ReceivedLot;
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
  // Less counted than held leaves from the lots that expire soonest, and of a hair system the pieces never labelled
  // first, any unit taken gone missing; more goes into the lot named, or none, and unlabelled.
  const taken =
    found.difference < 0
      ? await takenFrom(db, {
          code: input.code,
          place: input.place,
          quantity: -found.difference,
          prefer: "unlabelled",
        })
      : null;
  const takes = taken?.takes ?? [];
  const intoLot =
    found.difference > 0 && input.lot !== undefined
      ? await receivedLotMoves(
          db,
          { code: input.code, lot: input.lot, movementId: id, quantity: found.difference, place: input.place },
          written.now,
        )
      : null;
  const [row] = await db.batch([
    countStatement({ db, id, movement, held: found.held, written }),
    auditStatementIfWritten(db, entry("stock.count", input.code, written, detail), written.now, {
      table: "stock_movements",
      id,
    }),
    ...lotMoves(db, { movementId: id, place: input.place, takes, sign: -1 }),
    ...(intoLot?.statements ?? []),
    ...unitChanges(db, {
      units: taken?.units ?? [],
      state: "missing",
      place: null,
      movementId: id,
      ...unitWritten(written),
    }),
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
    readonly units?: readonly string[] | null;
  },
  written: Written,
): Promise<Moved> {
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  const kind = await kindOf(db, input.place);
  if (kind === null) return { ok: false, fields: ["place_id"] };
  const id = crypto.randomUUID();
  const taken = await takenFrom(db, { ...input, lotId: input.lotId ?? null, named: input.units ?? null });
  if (taken === null) return { ok: false, fields: ["units"] };
  const takes = taken.takes;
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
    ...unitChanges(db, {
      units: taken.units,
      state: "written_off",
      place: null,
      movementId: id,
      ...unitWritten(written),
    }),
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
