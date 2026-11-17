// A client's hair system marked failed by ops, or a failure taken back (docs/decisions/0273-why-a-hair-system-failed.md):
// from the client's Hair systems tab, or as Care close a claim or a chat about one. A failure is kept as the
// technician's piece step keeps it, in its reason's words with the failure list's code, so the client is owed a
// replacement as they are for one the technician recorded (src/domain/booking/remakes.ts), and its return, still to be
// settled, is claimed for that reason.

import { indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { refusal, type Refusal } from "../../lib/refusal.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";
import { jobSheet } from "../field/job-sheet-settings.ts";

interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

interface PieceRow {
  readonly id: string;
  readonly fitted_at: string | null;
  readonly failed_at: string | null;
}

/** A stored day or instant as India's day. */
const dayOf = (stored: string): string => (stored.length > 10 ? indiaDate(new Date(stored)) : stored);

const pieceOf = (db: D1Database, personId: string, pieceCode: string) =>
  db
    .prepare(
      "SELECT id, fitted_at, failed_at FROM pieces WHERE person_id = ?1 AND piece_code = ?2 AND deleted_at IS NULL",
    )
    .bind(personId, pieceCode)
    .first<PieceRow>();

export type FailureMarked =
  { readonly ok: true } | Refusal<"not_found"> | Refusal<"not_changeable"> | Refusal<"invalid_request">;

/**
 * Marks the client's piece failed on the day given, for a reason on the failure list now. Refused for a piece already
 * failed, a reason not on the list, or a day before its fit or after today in India.
 */
export async function markFailed(
  db: D1Database,
  failure: { readonly personId: string; readonly pieceCode: string; readonly reason: string; readonly on: string },
  written: Written,
): Promise<FailureMarked> {
  const [piece, sheet] = await Promise.all([pieceOf(db, failure.personId, failure.pieceCode), jobSheet(db)]);
  if (piece === null) return refusal("not_found");
  if (piece.failed_at !== null) return refusal("not_changeable");
  const reason = sheet.failureReasons.items.find((item) => item.id === failure.reason);
  const fitted = piece.fitted_at === null ? null : dayOf(piece.fitted_at);
  const fields = [
    ...(reason === undefined ? ["failure_reason"] : []),
    ...(failure.on > indiaDate(written.now) || (fitted !== null && failure.on < fitted) ? ["failed_on"] : []),
  ];
  if (reason === undefined || fields.length > 0) return refusal("invalid_request", fields);

  // Noon in India, so the day reads as given wherever the instant is read as a date.
  const at = indiaInstant(failure.on, "12:00").toISOString();
  const now = written.now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE pieces SET failed_at = ?2, failure_reason = ?3, failure_code = ?4, synced_at = ?5
         WHERE id = ?1 AND failed_at IS NULL`,
      )
      .bind(piece.id, at, reason.label, reason.id, now),
    db
      .prepare("UPDATE piece_returns SET reason = ?2 WHERE piece_code = ?1 AND reason IS NULL AND settled_at IS NULL")
      .bind(failure.pieceCode, reason.label),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "piece.failed",
        subject: { kind: "person", id: failure.personId },
        requestId: written.requestId,
        detail: { piece_code: failure.pieceCode, reason: reason.id, failed_on: failure.on },
      },
      written.now,
    ),
  ]);
  return { ok: true };
}

export type FailureUndone = { readonly ok: true } | Refusal<"not_found"> | Refusal<"not_changeable">;

/**
 * Takes back the client's piece's failure, its return's reason with it while that is still to be settled. A piece
 * another was fitted after is retired as replaced when it came off, as it would have been had it not failed.
 */
export async function undoFailure(
  db: D1Database,
  piece: { readonly personId: string; readonly pieceCode: string },
  written: Written,
): Promise<FailureUndone> {
  const row = await pieceOf(db, piece.personId, piece.pieceCode);
  if (row === null) return refusal("not_found");
  if (row.failed_at === null) return refusal("not_changeable");
  await db.batch([
    db
      .prepare(
        `UPDATE pieces SET
           replaced_at = COALESCE(replaced_at, CASE WHEN EXISTS (
             SELECT 1 FROM pieces n WHERE n.person_id = pieces.person_id AND n.id <> pieces.id
               AND n.deleted_at IS NULL AND n.fitted_at > pieces.fitted_at) THEN failed_at END),
           failed_at = NULL, failure_reason = NULL, failure_code = NULL, synced_at = ?2
         WHERE id = ?1`,
      )
      .bind(row.id, written.now.toISOString()),
    db
      .prepare("UPDATE piece_returns SET reason = NULL WHERE piece_code = ?1 AND settled_at IS NULL")
      .bind(piece.pieceCode),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "piece.failure_undone",
        subject: { kind: "person", id: piece.personId },
        requestId: written.requestId,
        detail: { piece_code: piece.pieceCode },
      },
      written.now,
    ),
  ]);
  return { ok: true };
}

/** Where a piece already failed, the first failure recorded stands, as a piece step's does. */
const standing = (marked: FailureMarked): FailureMarked =>
  !marked.ok && marked.code === "not_changeable" ? { ok: true } : marked;

/**
 * A guarantee claim closed with the hair system at fault: the piece its fit put on failed today. Refused where no piece
 * of that fit is on record.
 */
export async function failClaimedPiece(
  db: D1Database,
  claim: { readonly reportId: string; readonly reason: string },
  written: Written,
): Promise<FailureMarked> {
  const piece = await db
    .prepare(
      `SELECT p.person_id, p.piece_code FROM client_reports r
       JOIN pieces p ON p.appointment_id = r.claim_visit_id AND p.person_id IS NOT NULL AND p.deleted_at IS NULL
       WHERE r.id = ?1 ORDER BY p.fitted_at DESC LIMIT 1`,
    )
    .bind(claim.reportId)
    .first<{ person_id: string; piece_code: string }>();
  if (piece === null) return refusal("invalid_request", ["failure_reason"]);
  const on = indiaDate(written.now);
  return standing(
    await markFailed(db, { personId: piece.person_id, pieceCode: piece.piece_code, reason: claim.reason, on }, written),
  );
}

/** The piece the client on a chat's number wears now; null for none. */
const wornPieceOnChat = (db: D1Database, conversationId: string) =>
  db
    .prepare(
      `SELECT p.person_id, p.piece_code FROM conversations c JOIN people pe ON pe.mobile_e164 = c.mobile_e164
       JOIN pieces p ON p.person_id = pe.id
       WHERE c.id = ?1 AND p.deleted_at IS NULL AND p.failed_at IS NULL AND p.replaced_at IS NULL
         AND p.fitted_at IS NOT NULL
       ORDER BY p.fitted_at DESC LIMIT 1`,
    )
    .bind(conversationId)
    .first<{ person_id: string; piece_code: string }>();

/**
 * A chat closed with the hair system its report was about at fault: the piece the client wears failed today. Refused
 * where they wear none.
 */
export async function failWornPiece(
  db: D1Database,
  chat: { readonly conversationId: string; readonly reason: string },
  written: Written,
): Promise<FailureMarked> {
  const piece = await wornPieceOnChat(db, chat.conversationId);
  if (piece === null) return refusal("invalid_request", ["failure_reason"]);
  const on = indiaDate(written.now);
  return standing(
    await markFailed(db, { personId: piece.person_id, pieceCode: piece.piece_code, reason: chat.reason, on }, written),
  );
}
