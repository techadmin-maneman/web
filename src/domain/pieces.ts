// A client's pieces (docs/prompts/phase2-backend.md, "Pieces tab"), recorded as the technician's piece step lands.
//
// "For each piece: code, base, fitted date, supplier lot, replacement due date, and failure with reason." The
// replacement due date is computed from the base's cycle (src/config/pieces.ts).
//
// The technician's label lookup reads these rows, so scanning a label works with no signal.

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

/** A piece fitted on a visit. Its own ID is its FSM ID (docs/schema.md). */
export interface FittedPiece {
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
export function fittedPieceStatement(db: D1Database, piece: FittedPiece): D1PreparedStatement {
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
