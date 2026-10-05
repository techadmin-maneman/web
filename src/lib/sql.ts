// One row written from one object: its columns and their placeholders come from the same keys, so a column added or
// moved cannot take another's value.

export type SqlValue = string | number | null;

/**
 * `INSERT INTO table (…) VALUES (?1, …)` with the row's values bound in its columns' order. `tail` follows the
 * VALUES, as an ON CONFLICT clause that reads `excluded`.
 */
export function insertRow(
  db: D1Database,
  table: string,
  row: Readonly<Record<string, SqlValue>>,
  tail = "",
): D1PreparedStatement {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `?${String(index + 1)}`);
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
  return db.prepare(tail === "" ? sql : `${sql} ${tail}`).bind(...Object.values(row));
}
