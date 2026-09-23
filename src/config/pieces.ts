// Pieces, as the pieces tab reads them (docs/prompts/phase2-backend.md,
// "Pieces tab"). A piece is an asset in FSM; these are the figures our own
// side computes from it.
//
// The prompt says the replacement due date "follows the per-base cycle config
// already defined in this prompt", but no cycle is written anywhere in it, so
// every figure here is a placeholder until the owner rules them
// (docs/open-points.md, item 52). The label format is item 25's placeholder.

/** How long a piece on each base lasts before it is due for replacement, in days. */
export const PIECE_CYCLE_DAYS: Readonly<Record<string, number>> = {
  // 8 months, the design's "replacement due in March" from a July fit.
  PLACEHOLDER_STANDARD: 240,
};

/** The cycle used for a base with no figure of its own. */
export const DEFAULT_PIECE_CYCLE_DAYS = 240;

export const cycleDaysFor = (base: string | null): number =>
  (base === null ? undefined : PIECE_CYCLE_DAYS[base]) ?? DEFAULT_PIECE_CYCLE_DAYS;

/**
 * The label a technician scans, e.g. "MM-STD-4417-B". A placeholder format:
 * "MM", a base code, digits and a letter, in capitals. Whether labels carry a
 * barcode or a QR code is item 25 as well, and does not change this: the app
 * sends whatever the scan or the typing produced, and it is matched here.
 */
export const PIECE_CODE_PATTERN = /^MM-[A-Z0-9]{2,6}-\d{2,8}-[A-Z]$/;

export const isPieceCode = (code: string): boolean => PIECE_CODE_PATTERN.test(code);
