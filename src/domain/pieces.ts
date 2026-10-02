// A client's pieces, mirrored from FSM's assets. FSM holds the asset; the
// replacement due date is ours, computed from the base's cycle
// (src/config/pieces.ts), because FSM has no field for it.
//
// A piece is only ever the client's whose FSM contact holds the asset, and our
// copy never moves a piece from one client to another: when FSM disagrees, ops
// are told and decide.
//
// The technician's label lookup reads this copy. A piece write naming a code
// the copy does not know reads the client's own assets in FSM for it, in case
// the piece was added there after the last sync.

import { cycleDaysFor, type Cycles } from "../config/pieces.ts";
import { addDays } from "../lib/india-time.ts";
import type { FsmAsset, FsmProvider } from "../providers/fsm.ts";
import type { AlertOnce } from "./alerts.ts";

export interface Piece {
  readonly id: string;
  readonly piece_code: string;
  readonly base: string | null;
  readonly supplier_lot: string | null;
  readonly fitted_at: string | null;
  readonly replacement_due_at: string | null;
  readonly failed_at: string | null;
  readonly failure_reason: string | null;
}

interface PieceRow {
  id: string;
  piece_code: string;
  base: string | null;
  supplier_lot: string | null;
  fitted_at: string | null;
  replacement_due_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

const SELECT_PIECE = `SELECT id, piece_code, base, supplier_lot, fitted_at, replacement_due_at, failed_at,
  failure_reason FROM pieces WHERE deleted_at IS NULL`;

/** A client's pieces, newest fit first. */
export async function piecesOf(db: D1Database, personId: string): Promise<Piece[]> {
  const { results } = await db
    .prepare(`${SELECT_PIECE} AND person_id = ?1 ORDER BY fitted_at DESC, piece_code`)
    .bind(personId)
    .all<PieceRow>();
  return results;
}

/** The piece a label names, with the person it belongs to. */
export async function pieceWithOwner(
  db: D1Database,
  code: string,
): Promise<{ piece: Piece; personId: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT id, piece_code, base, supplier_lot, fitted_at, replacement_due_at, failed_at, failure_reason, person_id
       FROM pieces WHERE deleted_at IS NULL AND piece_code = ?1 LIMIT 1`,
    )
    .bind(code)
    .first<PieceRow & { person_id: string | null }>();
  if (row === null) return null;
  const { person_id: personId, ...piece } = row;
  return { piece, personId };
}

/** A client, and the FSM contact whose assets are their pieces. */
export interface PieceOwner {
  readonly personId: string;
  readonly fsmContactId: string;
}

/** What reading a client's pieces from FSM needs. */
export interface PieceSyncDeps {
  readonly fsm: FsmProvider;
  readonly alertOnce: AlertOnce;
  /** The replacement cycles in force, which ops set. */
  readonly cycles: Cycles;
}

/**
 * Writes the client's FSM assets over our copy; how many were written. FSM's
 * Installation_Date is the fitted date; the replacement due date follows the
 * base's cycle, since FSM holds none. An asset our copy has on another client
 * stays there, and ops are told.
 */
export async function syncPieces(db: D1Database, deps: PieceSyncDeps, owner: PieceOwner, now: Date): Promise<number> {
  const assets = await assetsOf(deps.fsm, owner.fsmContactId);
  if (assets.length === 0) return 0;
  const at = now.toISOString();
  const results = await db.batch(assets.map((asset) => upsertStatement(db, owner.personId, asset, at, deps.cycles)));
  // The upsert changes no row for an asset another client holds.
  const heldByOthers = assets.filter((_asset, index) => results[index]?.meta.changes === 0);
  for (const asset of heldByOthers) await alertOwnerMismatch(db, deps.alertOnce, owner, asset);
  return assets.length - heldByOthers.length;
}

/** The assets FSM holds against this contact, and no other's, newest first. */
async function assetsOf(fsm: FsmProvider, fsmContactId: string): Promise<FsmAsset[]> {
  const assets = await fsm.assets(fsmContactId);
  return assets.filter((asset) => asset.contactId === fsmContactId);
}

async function alertOwnerMismatch(
  db: D1Database,
  alertOnce: AlertOnce,
  owner: PieceOwner,
  asset: FsmAsset,
): Promise<void> {
  const holder = await db
    .prepare("SELECT person_id FROM pieces WHERE fsm_id = ?1")
    .bind(asset.id)
    .first<string | null>("person_id");
  const ours = holder === null ? "no client" : `client ${holder}`;
  await alertOnce({
    key: `piece_owner_mismatch:${asset.id}`,
    message:
      `FSM lists piece ${asset.assetNumber} (asset ${asset.id}) under client ${owner.personId}, but our records ` +
      `have it on ${ours}, so it was not moved. Check in FSM which client wears it and correct the asset's contact.`,
    link: `/clients/${owner.personId}`,
  });
}

function upsertStatement(
  db: D1Database,
  personId: string,
  asset: FsmAsset,
  at: string,
  cycles: Cycles,
): D1PreparedStatement {
  const base = asset.productName;
  const fittedAt = asset.installedAt;
  const due = fittedAt === null ? null : addDays(fittedAt.slice(0, 10), cycleDaysFor(base, cycles));
  // Inactive is how recordFailedPiece marks one, below; the others are words ops may use in FSM.
  const failed = asset.status !== null && /fail|replac|retired|inactive/i.test(asset.status);
  return db
    .prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at,
         failed_at, synced_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)
       ON CONFLICT (fsm_id) DO UPDATE SET
         piece_code = excluded.piece_code, base = excluded.base,
         supplier_lot = excluded.supplier_lot, fitted_at = excluded.fitted_at,
         replacement_due_at = excluded.replacement_due_at,
         failed_at = COALESCE(pieces.failed_at, excluded.failed_at),
         synced_at = excluded.synced_at, deleted_at = NULL
       WHERE pieces.person_id = excluded.person_id`,
    )
    .bind(
      crypto.randomUUID(),
      asset.id,
      personId,
      asset.assetNumber,
      base,
      asset.serialNumber,
      fittedAt,
      due,
      failed ? at : null,
      at,
    );
}

export interface FittedPiece {
  readonly personId: string;
  readonly fsmContactId: string;
  readonly appointmentId: string;
  readonly pieceCode: string;
  readonly base: string | null;
  readonly supplierLot: string | null;
  /** YYYY-MM-DD. */
  readonly fittedOn: string;
  readonly replacementDue: string;
  readonly now: Date;
}

/**
 * Records a piece the technician fitted: an asset in FSM first, then our copy.
 * A replay writes the same asset only once, because the code is looked up first:
 * in our copy, then among the client's assets in FSM, where a create whose
 * answer never reached us left it.
 */
export async function recordFittedPiece(db: D1Database, fsm: FsmProvider, piece: FittedPiece): Promise<string> {
  const held = await db
    .prepare("SELECT fsm_id FROM pieces WHERE piece_code = ?1 AND deleted_at IS NULL")
    .bind(piece.pieceCode)
    .first<{ fsm_id: string }>();
  if (held !== null) return held.fsm_id;

  const inFsm = (await assetsOf(fsm, piece.fsmContactId)).find((asset) => asset.assetNumber === piece.pieceCode);
  const fsmId =
    inFsm?.id ??
    (await fsm.createAsset({
      contactId: piece.fsmContactId,
      assetNumber: piece.pieceCode,
      productId: await partItemId(db, fsm, piece.base, piece.now),
      serialNumber: piece.supplierLot,
      installedAt: piece.fittedOn,
    }));
  await db
    .prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at,
         appointment_id, synced_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (fsm_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      fsmId,
      piece.personId,
      piece.pieceCode,
      piece.base,
      piece.supplierLot,
      piece.fittedOn,
      piece.replacementDue,
      piece.appointmentId,
      piece.now.toISOString(),
    )
    .run();
  return fsmId;
}

/**
 * Records a piece that failed: FSM's asset status first, then our copy's reason.
 * FSM's asset has no field we know of for the reason, so it reaches FSM on the
 * job's summary (src/domain/job-sheet.ts). A label that neither our copy nor
 * the client's assets in FSM know is left to ops.
 */
export async function recordFailedPiece(db: D1Database, deps: PieceSyncDeps, failure: FailedPiece): Promise<boolean> {
  const fsmId = (await heldPieceId(db, failure.pieceCode)) ?? (await pieceIdFromFsm(db, deps, failure));
  if (fsmId === null) {
    await alertUnknownPiece(deps.alertOnce, failure);
    return false;
  }
  await deps.fsm.updateAsset(fsmId, { status: "Inactive" });
  await db
    .prepare(
      `UPDATE pieces SET failed_at = COALESCE(failed_at, ?2), failure_reason = COALESCE(failure_reason, ?3),
         synced_at = ?2 WHERE fsm_id = ?1`,
    )
    .bind(fsmId, failure.now.toISOString(), failure.reason)
    .run();
  return true;
}

export interface FailedPiece {
  readonly pieceCode: string;
  readonly reason: string;
  /** The job's client; null when the job has no client in FSM. */
  readonly owner: PieceOwner | null;
  readonly now: Date;
}

async function heldPieceId(db: D1Database, pieceCode: string): Promise<string | null> {
  return db
    .prepare("SELECT fsm_id FROM pieces WHERE piece_code = ?1 AND deleted_at IS NULL")
    .bind(pieceCode)
    .first<string>("fsm_id");
}

/** Reads the client's pieces afresh from FSM, then looks for the label in our copy again. */
async function pieceIdFromFsm(db: D1Database, deps: PieceSyncDeps, failure: FailedPiece): Promise<string | null> {
  if (failure.owner === null) return null;
  await syncPieces(db, deps, failure.owner, failure.now);
  return heldPieceId(db, failure.pieceCode);
}

async function alertUnknownPiece(alertOnce: AlertOnce, failure: FailedPiece): Promise<void> {
  const { owner, pieceCode } = failure;
  const whose = owner === null ? "the client's" : `client ${owner.personId}'s`;
  await alertOnce({
    key: `piece_unknown:${pieceCode}`,
    message:
      `A technician marked piece ${pieceCode} as failed, but it is not among ${whose} pieces here or in FSM, ` +
      "so nothing was marked. Find it in FSM and set its status to Inactive.",
    link: owner === null ? undefined : `/clients/${owner.personId}`,
  });
}

/**
 * The part item in FSM a piece's base is: the named one, else the first part in
 * the catalogue. An asset needs one. The catalogue is read afresh when our copy
 * of it has no part yet, as the mirror's own item lookup does.
 */
async function partItemId(db: D1Database, fsm: FsmProvider, base: string | null, now: Date): Promise<string> {
  const held = await partIn(db, base);
  if (held !== null) return held;

  const items = await fsm.items();
  if (items.length > 0) {
    const at = now.toISOString();
    await db.batch(
      items.map((item) =>
        db
          .prepare(
            `INSERT INTO fsm_items (fsm_id, name, type, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (fsm_id) DO UPDATE SET name = excluded.name, type = excluded.type,
               updated_at = excluded.updated_at`,
          )
          .bind(item.id, item.name, item.type, at),
      ),
    );
  }
  const found = await partIn(db, base);
  if (found === null) throw new Error("FSM's catalogue holds no part item for the piece's base");
  return found;
}

/**
 * A part a piece can be built on. The catalogue holds ops' consumables as parts
 * too (docs/decisions/0087-consumables-and-stock.md), and a piece is never an
 * asset of a sachet of shampoo, so none of theirs is taken.
 */
async function partIn(db: D1Database, base: string | null): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT fsm_id FROM fsm_items WHERE type = 'Part' AND (?1 IS NULL OR name = ?1)
         AND fsm_id NOT IN (SELECT fsm_item_id FROM consumables WHERE fsm_item_id IS NOT NULL)
         AND name NOT IN (SELECT name FROM consumables)
       ORDER BY name LIMIT 1`,
    )
    .bind(base)
    .first<{ fsm_id: string }>();
  return row?.fsm_id ?? null;
}
