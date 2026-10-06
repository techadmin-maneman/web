// Pieces, as the pieces tab reads them (docs/prompts/phase2-backend.md,
// "Pieces tab"). These are the figures computed from a piece as it is recorded.
//
// A piece falls due for replacement 180 days after it is fitted, whatever its
// base. Ops may give a base a cycle of its own in the console (Settings · Rules).

/** How long a piece on each base lasts before it is due for replacement, in days. */
export type Cycles = Readonly<Record<string, number>>;

/** The map stays per base so a base can be given its own cycle without touching anything that reads it. */
export const PIECE_CYCLE_DAYS: Cycles = {};

/** The cycle used for a base with no figure of its own, which is every base: 6 months. */
export const DEFAULT_PIECE_CYCLE_DAYS = 180;

/**
 * The cycle for a base: the one ops have set, or the map above. The cycles are
 * an ops-editable input (docs/decisions/0061-ops-editable-inputs.md), where
 * `default` holds the figure for a base with none of its own.
 */
export const cycleDaysFor = (base: string | null, cycles: Cycles = PIECE_CYCLE_DAYS): number =>
  (base === null ? undefined : cycles[base]) ?? cycles.default ?? DEFAULT_PIECE_CYCLE_DAYS;

/**
 * The label a technician types, e.g. "MM-STD-4417-B": "MM", a base code, digits
 * and a letter, in capitals. There is no barcode or QR code, so the code is
 * always typed by hand and matched here.
 */
const PIECE_CODE_PATTERN = /^MM-[A-Z0-9]{2,6}-\d{2,8}-[A-Z]$/;

export const isPieceCode = (code: string): boolean => PIECE_CODE_PATTERN.test(code);
