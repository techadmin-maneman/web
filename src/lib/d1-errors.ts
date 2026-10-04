// What a D1 error says, read in one place. D1 gives no codes, only SQLite's and its own words, so these are the only
// readers of an error's message (eslint.config.js holds every other file to that).

/** Whether a write failed on one of this table's unique keys, as SQLite words it: "UNIQUE constraint failed: t.c". */
export const failedUniqueOn = (error: unknown, table: string): boolean =>
  error instanceof Error && error.message.includes(`UNIQUE constraint failed: ${table}.`);

/** Whether a write failed for want of this column, as SQLite words it: "NOT NULL constraint failed: t.c". */
export const failedNotNullOn = (error: unknown, column: string): boolean =>
  error instanceof Error && error.message.includes(`NOT NULL constraint failed: ${column}`);

/**
 * D1's failures that pass by themselves, as seen on staging: a lost connection, its storage object reset, a database
 * held by an export someone was running, and its storage's own internal errors.
 */
const TRANSIENT = [
  "Network connection lost",
  "D1_RESET_DO",
  "long-running export",
  "storage caused object to be reset",
  "Internal error in D1 DB storage",
] as const;

export const isTransientD1Error = (error: unknown): boolean =>
  error instanceof Error && TRANSIENT.some((words) => error.message.includes(words));
