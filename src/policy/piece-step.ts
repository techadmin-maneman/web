// What a piece step records of the piece fitted, or of the one that failed, once its labels are checked against the
// label's pattern (src/config/pieces.ts).

import { isPieceCode } from "../config/pieces.ts";

type OldPiece = { readonly piece_code: string; readonly failure_reason: string };

/** A piece step as the phone sends it: the piece, its base and lot, and on a replacement the one that came off. */
type PieceSent = {
  readonly piece_code: string;
  readonly base?: string | null;
  readonly supplier_lot?: string | null;
  readonly failure_reason?: string | null;
  readonly old_piece?: OldPiece | null;
};

/** What the step records: every field, null where the phone sent none. */
type PieceRecorded = {
  readonly piece_code: string;
  readonly base: string | null;
  readonly supplier_lot: string | null;
  readonly failure_reason: string | null;
  readonly old_piece: OldPiece | null;
};

/** The piece as the step records it, or the field whose label is not one. */
export function pieceRecorded(sent: PieceSent): PieceRecorded | { readonly invalid: string[] } {
  if (!isPieceCode(sent.piece_code)) return { invalid: ["piece_code"] };
  const oldPiece = sent.old_piece ?? null;
  if (oldPiece !== null && !isPieceCode(oldPiece.piece_code)) return { invalid: ["old_piece"] };
  return {
    piece_code: sent.piece_code,
    base: sent.base ?? null,
    supplier_lot: sent.supplier_lot ?? null,
    failure_reason: sent.failure_reason ?? null,
    old_piece: oldPiece,
  };
}
