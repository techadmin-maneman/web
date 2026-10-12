// Transfers in transit (docs/decisions/0158-transfers-in-transit.md): stock sent to a warehouse, a hub or a stockroom
// leaves its place when it is sent, of the lots that expire soonest, and arrives only when the other end receives it,
// in full or short; until then it is in transit. One sent back before it arrives returns to where it left, of the
// same lots. Stock handed to a kit arrives at once, as every transfer did before (src/domain/field/stock.ts).
//
// Receiving and sending back each settle the transfer in the first statement of their batch, and every row after it
// is written only where that statement settled it, so two people settling one transfer at once settle it once.

import { auditStatement, auditStatementWhen, type AuditEntry } from "../ops/audit.ts";
import { lotMoves, type LotTake } from "./stock-lots.ts";
import { placeById, type Place } from "./stock-places.ts";
import { hairSystemProduct, piecesArriving, takenFrom, unitChanges } from "./stock-units.ts";
import {
  consumableExists,
  kindOf,
  movementStatement,
  movementStatementWhen,
  transferStock,
  unitWritten,
  type Moved,
  type Written,
} from "./stock.ts";

/** A transfer still on its way, as the Stock page lists it. */
export interface InTransit {
  readonly id: string;
  readonly code: string;
  readonly quantity: number;
  readonly from: Place;
  readonly to: Place;
  readonly sentAt: string;
  readonly sentBy: string;
}

interface TransferRow {
  readonly id: string;
  readonly consumable_code: string;
  readonly quantity: number;
  readonly from_place: string;
  readonly to_place: string;
  readonly state: "in_transit" | "received" | "cancelled";
  readonly sent_at: string;
  readonly sent_by: string;
}

const TRANSFER_COLUMNS = "id, consumable_code, quantity, from_place, to_place, state, sent_at, sent_by";

const inTransitOf = (row: TransferRow): InTransit => ({
  id: row.id,
  code: row.consumable_code,
  quantity: row.quantity,
  from: row.from_place,
  to: row.to_place,
  sentAt: row.sent_at,
  sentBy: row.sent_by,
});

/** Every transfer on its way, the oldest first. */
export async function inTransit(db: D1Database): Promise<InTransit[]> {
  const { results } = await db
    .prepare(`SELECT ${TRANSFER_COLUMNS} FROM stock_transfers WHERE state = 'in_transit' ORDER BY sent_at`)
    .all<TransferRow>();
  return results.map(inTransitOf);
}

function entry(
  action: "stock.send" | "stock.receive_transfer" | "stock.send_back",
  code: string,
  written: Written,
  detail: AuditEntry["detail"],
): AuditEntry {
  return {
    surface: "ops",
    actor: written.actor,
    action,
    subject: { kind: "consumable", id: code },
    requestId: written.requestId,
    detail,
  };
}

/**
 * Stock moved from one place to another: handed over at once to a kit, or sent to any other place, leaving its own
 * now and arriving when received.
 */
export async function sendStock(
  db: D1Database,
  input: { readonly code: string; readonly quantity: number; readonly from: Place; readonly to: Place },
  written: Written,
): Promise<Moved> {
  const to = await placeById(db, input.to);
  if (to === null || to.kind === "kit" || input.from === input.to) return transferStock(db, input, written);
  if (!(await consumableExists(db, input.code))) return { ok: false, fields: ["consumable_code"] };
  const fromKind = await kindOf(db, input.from);
  if (fromKind === null) return { ok: false, fields: ["from"] };
  const transferId = crypto.randomUUID();
  const out = crypto.randomUUID();
  const taken = await takenFrom(db, { code: input.code, place: input.from, quantity: input.quantity });
  const takes = taken?.takes ?? [];
  const detail = { quantity: input.quantity, from: input.from, to: input.to, transfer: transferId };
  const movement = { code: input.code, reason: "transferred", transferId, note: null } as const;
  await db.batch([
    db
      .prepare(
        `INSERT INTO stock_transfers (id, consumable_code, quantity, from_place, to_place, state, sent_by, sent_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'in_transit', ?6, ?7)`,
      )
      .bind(transferId, input.code, input.quantity, input.from, input.to, written.actor.id, written.now.toISOString()),
    auditStatement(db, entry("stock.send", input.code, written, detail), written.now),
    movementStatement(db, { ...movement, place: input.from, kind: fromKind, quantity: -input.quantity }, written, out),
    ...lotMoves(db, { movementId: out, place: input.from, takes, sign: -1 }),
    ...unitChanges(db, {
      units: taken?.units ?? [],
      state: "in_transit",
      place: input.to,
      movementId: out,
      transferId,
      ...unitWritten(written),
    }),
  ]);
  return { ok: true, lowered: [input.from] };
}

/** What a transfer took of each lot as it left, soonest to expire first, up to `quantity` of it. */
async function lotsSent(db: D1Database, transferId: string, quantity: number): Promise<LotTake[]> {
  const { results } = await db
    .prepare(
      `SELECT lm.lot_id, -lm.quantity AS sent FROM stock_movements m
       JOIN stock_lot_moves lm ON lm.movement_id = m.id JOIN stock_lots l ON l.id = lm.lot_id
       WHERE m.transfer_id = ?1 AND m.quantity < 0
       ORDER BY l.expires_on IS NULL, l.expires_on, l.received_at`,
    )
    .bind(transferId)
    .all<{ lot_id: string; sent: number }>();
  const takes: LotTake[] = [];
  let left = quantity;
  for (const lot of results) {
    if (left <= 0) break;
    const taken = Math.min(left, lot.sent);
    takes.push({ lotId: lot.lot_id, quantity: taken });
    left -= taken;
  }
  return takes;
}

/**
 * What a transfer brings of each lot, and its units' changes, each written only where this request settled it: a hair
 * system's units arrive before its pieces never labelled, and any not arriving went missing on the way.
 */
async function arrivingAt(
  db: D1Database,
  { transfer, arrived }: { readonly transfer: TransferRow; readonly arrived: number },
  settled: { readonly place: Place; readonly movementId: string | null; readonly settlement: string; written: Written },
): Promise<{ readonly takes: readonly LotTake[]; readonly units: D1PreparedStatement[] }> {
  if ((await hairSystemProduct(db, transfer.consumable_code)) === null) {
    return { takes: await lotsSent(db, transfer.id, arrived), units: [] };
  }
  const arriving = await piecesArriving(db, transfer, arrived);
  const when = {
    sql: "EXISTS (SELECT 1 FROM stock_transfers WHERE id = ? AND settlement_id = ?)",
    binds: [transfer.id, settled.settlement],
  };
  const moved = { movementId: settled.movementId, ...unitWritten(settled.written) };
  return {
    takes: arriving.takes,
    units: [
      ...unitChanges(db, { ...moved, units: arriving.units, state: "held", place: settled.place }, when),
      ...unitChanges(db, { ...moved, units: arriving.lost, state: "missing", place: null }, when),
    ],
  };
}

/** A transfer received, or sent back; refused, or settled already by someone else. */
export type Settled =
  | { readonly ok: true; readonly touched: readonly Place[] }
  | { readonly ok: false; readonly fields: string[] }
  | { readonly ok: false; readonly missing: true }
  | { readonly ok: false; readonly settled: true };

/**
 * A transfer settled: received at the place it was sent to, `arrived` of it, the rest lost on the way; or sent back,
 * all of it arriving where it left. The first statement settles it, and the rest are written only where it did.
 */
async function settle(
  db: D1Database,
  input: {
    readonly id: string;
    readonly back: boolean;
    readonly arrived: number | null;
    readonly note: string | null;
  },
  written: Written,
): Promise<Settled> {
  const transfer = await db
    .prepare(`SELECT ${TRANSFER_COLUMNS} FROM stock_transfers WHERE id = ?1`)
    .bind(input.id)
    .first<TransferRow>();
  if (transfer === null) return { ok: false, missing: true };
  if (transfer.state !== "in_transit") return { ok: false, settled: true };
  const arrived = input.back ? transfer.quantity : (input.arrived ?? transfer.quantity);
  if (arrived > transfer.quantity) return { ok: false, fields: ["received"] };
  const place = input.back ? transfer.from_place : transfer.to_place;
  const kind = await kindOf(db, place);
  if (kind === null) return { ok: false, fields: ["id"] };
  const at = written.now.toISOString();
  const into = crypto.randomUUID();
  const settlement = crypto.randomUUID();
  /** Whether this request settled the transfer, with its placeholders from ?first. */
  const settledHere = (first: number) => ({
    sql: `EXISTS (SELECT 1 FROM stock_transfers WHERE id = ?${String(first)} AND settlement_id = ?${String(first + 1)})`,
    binds: [transfer.id, settlement],
  });
  const movementId = arrived > 0 ? into : null;
  const arriving = await arrivingAt(db, { transfer, arrived }, { place, movementId, settlement, written });
  const takes = arriving.takes;
  const movement = movementStatementWhen(
    db,
    {
      id: into,
      movement: {
        code: transfer.consumable_code,
        place,
        kind,
        quantity: arrived,
        reason: "transferred",
        transferId: transfer.id,
        note: input.note,
      },
    },
    written,
    settledHere(13),
  );
  const detail = { transfer: transfer.id, quantity: transfer.quantity, arrived, place };
  const [settled] = await db.batch([
    db
      .prepare(
        `UPDATE stock_transfers SET state = ?2, received_quantity = ?3, note = ?4, settled_by = ?5, settled_at = ?6,
           settlement_id = ?7
         WHERE id = ?1 AND state = 'in_transit'`,
      )
      .bind(
        transfer.id,
        input.back ? "cancelled" : "received",
        input.back ? null : arrived,
        input.note,
        written.actor.id,
        at,
        settlement,
      ),
    auditStatementWhen(
      db,
      entry(input.back ? "stock.send_back" : "stock.receive_transfer", transfer.consumable_code, written, detail),
      written.now,
      settledHere(10),
    ),
    ...(arrived > 0 ? [movement] : []),
    ...lotMoves(db, { movementId: into, place, takes, sign: 1 }),
    ...arriving.units,
  ]);
  // Another request settled it between the read and this batch, which then wrote nothing.
  if (settled?.meta.changes !== 1) return { ok: false, settled: true };
  return { ok: true, touched: [place] };
}

/** The transfer received at the place it was sent to: `received` of it, all of it by default. */
export function receiveTransfer(
  db: D1Database,
  id: string,
  input: { readonly received: number | null; readonly note: string | null },
  written: Written,
): Promise<Settled> {
  return settle(db, { id, back: false, arrived: input.received, note: input.note }, written);
}

/** The transfer sent back to where it left, before it arrived. */
export function sendBack(db: D1Database, id: string, written: Written): Promise<Settled> {
  return settle(db, { id, back: true, arrived: null, note: null }, written);
}
