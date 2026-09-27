// How the technician app draws its glyphs (design/phase2/Technician App.dc.html):
// the brand's own, from @maneman/brand/icons, at the heavier strokes the board
// draws for reading in the sun, and the one glyph no other app draws.

/** The board draws its glyphs at 1.8, heavier than the icon set's 1.6. */
export const STROKE = 1.8;

/** A stepper's signs are drawn at 2 (board B3), and a ticked box's at 2.6 (board B2). */
export const STEPPER_STROKE = 2;
export const BOX_TICK_STROKE = 2.6;

/** Navigate, on the address (board A3). */
export const PIN =
  "M12 21 C7 16 4.5 12.6 4.5 9.5 A7.5 7.5 0 0 1 19.5 9.5 C19.5 12.6 17 16 12 21 Z M12 7 A2.6 2.6 0 0 1 12 12.2 A2.6 2.6 0 0 1 12 7";
