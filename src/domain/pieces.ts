// A client's pieces (docs/prompts/phase2-backend.md, "Pieces tab"), mirrored
// from FSM's assets (ADR 0032); where our own database holds the record of
// field work, recorded as the technician's piece step lands.
//
// "For each piece: code, base, fitted date, supplier lot, replacement due date,
// and failure with reason, all from FSM assets." FSM holds the asset; the
// replacement due date is ours, computed from the base's cycle
// (src/config/pieces.ts), because FSM has no field for it.
//
// The technician's label lookup reads this copy, so scanning a label works with
// no signal. A code the copy does not know is looked up in FSM once, in case
// the piece was added there after the last sync.

import { cycleDaysFor, type Cycles } from "../config/pieces.ts";
import { addDays } from "../lib/india-time.ts";
import type { FsmAsset, FsmProvider } from "../providers/fsm.ts";

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

/**
 * Writes FSM's assets for one contact over our copy. FSM's Installation_Date is
 * the fitted date; the replacement due date follows the base's cycle, since FSM
 * holds none.
 */
export async function syncPieces(
  db: D1Database,
  fsm: FsmProvider,
  client: { personId: string; fsmContactId: string },
  now: Date,
  cycles: Cycles,
): Promise<number> {
  const assets = await fsm.assets(client.fsmContactId);
  if (assets.length === 0) return 0;
  const at = now.toISOString();
  await db.batch(assets.map((asset) => upsertStatement(db, client.personId, asset, at, cycles)));
  return assets.length;
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
         person_id = excluded.person_id, piece_code = excluded.piece_code, base = excluded.base,
         supplier_lot = excluded.supplier_lot, fitted_at = excluded.fitted_at,
         replacement_due_at = excluded.replacement_due_at,
         failed_at = COALESCE(pieces.failed_at, excluded.failed_at),
         synced_at = excluded.synced_at, deleted_at = NULL`,
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

  const inFsm = (await fsm.assets(piece.fsmContactId)).find((asset) => asset.assetNumber === piece.pieceCode);
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
 * job's summary (src/domain/job-sheet.ts).
 */
export async function recordFailedPiece(
  db: D1Database,
  fsm: FsmProvider,
  failure: { pieceCode: string; reason: string; now: Date },
): Promise<boolean> {
  const held = await db
    .prepare("SELECT fsm_id FROM pieces WHERE piece_code = ?1 AND deleted_at IS NULL")
    .bind(failure.pieceCode)
    .first<{ fsm_id: string }>();
  if (held === null) return false;
  await fsm.updateAsset(held.fsm_id, { status: "Inactive" });
  await db
    .prepare(
      `UPDATE pieces SET failed_at = COALESCE(failed_at, ?2), failure_reason = COALESCE(failure_reason, ?3),
         synced_at = ?2 WHERE fsm_id = ?1`,
    )
    .bind(held.fsm_id, failure.now.toISOString(), failure.reason)
    .run();
  return true;
}

/** What a piece step says of the pieces: the one fitted, and each that failed with its reason. */
export interface PieceStep {
  readonly fitted: { readonly code: string; readonly base: string | null; readonly supplierLot: string | null } | null;
  readonly failed: readonly PieceFailure[];
}

/** A piece that failed, and the field of the step its label came in. */
export interface PieceFailure {
  readonly code: string;
  readonly reason: string;
  readonly field: PieceField;
}

/** The step's two labels: the piece it is about, and on a replacement the one that came off. */
export type PieceField = "piece_code" | "old_piece";

/**
 * The pieces a piece step's body names. A failure_reason on the piece itself marks that piece failed and fits nothing;
 * a one visit the client decided against names none.
 */
export function pieceStepOf(body: Record<string, unknown>): PieceStep {
  const failed: PieceFailure[] = [];
  const oldPiece = oldPieceOf(body.old_piece);
  if (oldPiece !== null) failed.push({ ...oldPiece, field: "old_piece" });

  const code = textOf(body.piece_code);
  if (code === null) return { fitted: null, failed };
  const failure = textOf(body.failure_reason);
  if (failure !== null) return { fitted: null, failed: [...failed, { code, reason: failure, field: "piece_code" }] };
  return { fitted: { code, base: textOf(body.base), supplierLot: textOf(body.supplier_lot) }, failed };
}

const textOf = (value: unknown): string | null => (typeof value === "string" ? value : null);

function oldPieceOf(value: unknown): { code: string; reason: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const piece = value as { piece_code?: unknown; failure_reason?: unknown };
  const code = textOf(piece.piece_code);
  const reason = textOf(piece.failure_reason);
  return code === null || reason === null ? null : { code, reason };
}

/**
 * The label of a piece step that cannot land on this visit, by its field; null when both can. A piece fitted must be
 * new to our records, or the one this visit already recorded: a label another client's piece carries, or this
 * client's own from an earlier visit, would record nothing for them, or two pieces as one. A piece that failed must be
 * this client's, or one we have no record of.
 */
export async function pieceLabelTaken(
  db: D1Database,
  visit: { readonly id: string; readonly personId: string | null },
  step: PieceStep,
): Promise<PieceField | null> {
  if (step.fitted !== null) {
    const held = await piecesLabelled(db, step.fitted.code);
    if (held.some((piece) => piece.appointment_id !== visit.id)) return "piece_code";
  }
  for (const failure of step.failed) {
    const held = await piecesLabelled(db, failure.code);
    if (held.some((piece) => piece.person_id !== visit.personId)) return failure.field;
  }
  return null;
}

async function piecesLabelled(
  db: D1Database,
  code: string,
): Promise<{ person_id: string | null; appointment_id: string | null }[]> {
  const { results } = await db
    .prepare("SELECT person_id, appointment_id FROM pieces WHERE piece_code = ?1 AND deleted_at IS NULL")
    .bind(code)
    .all<{ person_id: string | null; appointment_id: string | null }>();
  return results;
}

/** A piece fitted on a visit our own database holds the record of: its own ID is its FSM ID. */
export interface OurFittedPiece {
  readonly personId: string;
  readonly appointmentId: string;
  readonly pieceCode: string;
  readonly base: string | null;
  readonly supplierLot: string | null;
  /** YYYY-MM-DD. */
  readonly fittedOn: string;
  readonly replacementDue: string;
  readonly now: Date;
}

/** Records a piece fitted, once however often its step lands. */
export function fittedPieceStatement(db: D1Database, piece: OurFittedPiece): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at,
         appointment_id, synced_at)
       SELECT ?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE NOT EXISTS (SELECT 1 FROM pieces WHERE piece_code = ?3 AND deleted_at IS NULL)`,
    )
    .bind(
      crypto.randomUUID(),
      piece.personId,
      piece.pieceCode,
      piece.base,
      piece.supplierLot,
      piece.fittedOn,
      piece.replacementDue,
      piece.appointmentId,
      piece.now.toISOString(),
    );
}

/** Records the client's piece that failed, with its reason. The first failure recorded stands. */
export function failedPieceStatement(
  db: D1Database,
  failure: { readonly personId: string; readonly pieceCode: string; readonly reason: string; readonly now: Date },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE pieces SET failed_at = COALESCE(failed_at, ?3), failure_reason = COALESCE(failure_reason, ?4),
         synced_at = ?3
       WHERE piece_code = ?1 AND person_id = ?2 AND deleted_at IS NULL`,
    )
    .bind(failure.pieceCode, failure.personId, failure.now.toISOString(), failure.reason);
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
