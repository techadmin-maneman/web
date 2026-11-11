// How a technician's quality is counted on Me (docs/decisions/0249-schedule-kit-and-me.md): over the last 30 days, on
// time is checked in by the booked start, and the hairline redo rate is first fits followed by a free refit within
// 30 days.

/** The days each count looks back over. */
export const QUALITY_DAYS = 30;

/** The days after a first fit within which its free refit counts it redone. */
export const REDO_DAYS = 30;
