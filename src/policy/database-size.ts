// How full the database may get before ops are told. Workers Paid holds one D1 database to 10 GB (ADR 0112), and
// past it every write fails: the audit entry each ops call writes first, a booking, a payment. Ops are told well
// before, while there is time to make room.

/** Workers Paid's limit on one D1 database, in decimal bytes, the smaller reading of "10 GB". */
export const DATABASE_LIMIT_BYTES = 10e9;

/** Ops are told once as the database reaches each. */
const DATABASE_TOLD_AT_PERCENT = [50, 80, 95] as const;
type DatabaseMark = (typeof DATABASE_TOLD_AT_PERCENT)[number];

/** The highest mark the database has reached, or null below the first. */
export function databaseMarkReached(heldBytes: number): DatabaseMark | null {
  const percent = (heldBytes / DATABASE_LIMIT_BYTES) * 100;
  const reached = DATABASE_TOLD_AT_PERCENT.filter((mark) => percent >= mark);
  return reached.at(-1) ?? null;
}
