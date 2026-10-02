// How full the database may get before ops are told. Workers Free holds one D1 database to 500 MB (ADR 0009), and
// past it every write fails: the audit entry each ops call writes first, a booking, a payment. Ops are told well
// before, while there is time to make room or move to a paid plan.

/** Workers Free's limit on one D1 database, in decimal bytes, the smaller reading of "500 MB". */
export const DATABASE_LIMIT_BYTES = 500e6;

/** Ops are told once as the database reaches each. */
const DATABASE_TOLD_AT_PERCENT = [50, 80, 95] as const;
type DatabaseMark = (typeof DATABASE_TOLD_AT_PERCENT)[number];

/** The highest mark the database has reached, or null below the first. */
export function databaseMarkReached(heldBytes: number): DatabaseMark | null {
  const percent = (heldBytes / DATABASE_LIMIT_BYTES) * 100;
  const reached = DATABASE_TOLD_AT_PERCENT.filter((mark) => percent >= mark);
  return reached.at(-1) ?? null;
}
