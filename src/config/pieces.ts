// Pieces, as the pieces tab reads them (docs/prompts/phase2-backend.md,
// "Pieces tab"). A piece is an asset in FSM; these are the figures our own
// side computes from it.
//
// The prompt says the replacement due date "follows the per-base cycle config
// already defined in this prompt", but no cycle is written anywhere in it. The
// owner ruled the cycle on 24 September 2026: 180 days, the same for every base
// (docs/open-points.md, "The per-base replacement cycle"). The bases themselves
// are unnamed until the price book names them, so the entry below is a name
// standing in for one and every real base falls through to the default.

/** How long a piece on each base lasts before it is due for replacement, in days. */
export type Cycles = Readonly<Record<string, number>>;

export const PIECE_CYCLE_DAYS: Cycles = {
  // 6 months. The map stays per base so a base can be given its own cycle
  // without touching anything that reads it; today none has one.
  PLACEHOLDER_STANDARD: 180,
};

/** The cycle used for a base with no figure of its own, which is every base. */
export const DEFAULT_PIECE_CYCLE_DAYS = 180;

/**
 * The cycle for a base: the one ops have set, or the map above. The cycles are
 * an ops-editable input (docs/decisions/0060-ops-editable-inputs.md), where
 * `default` holds the figure for a base with none of its own.
 */
export const cycleDaysFor = (base: string | null, cycles: Cycles = PIECE_CYCLE_DAYS): number =>
  (base === null ? undefined : cycles[base]) ?? cycles.default ?? DEFAULT_PIECE_CYCLE_DAYS;

/**
 * The label a technician types, e.g. "MM-STD-4417-B": "MM", a base code, digits
 * and a letter, in capitals. The owner ruled the format on 24 September 2026
 * and ruled out a barcode and a QR code with it (docs/open-points.md, "Piece
 * labels"), so the code is always typed by hand and matched here.
 */
export const PIECE_CODE_PATTERN = /^MM-[A-Z0-9]{2,6}-\d{2,8}-[A-Z]$/;

export const isPieceCode = (code: string): boolean => PIECE_CODE_PATTERN.test(code);
