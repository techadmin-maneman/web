// Values written into SQL by hand, by the scripts and the browser tests' seeds. Nothing here runs a statement, so it
// loads anywhere a test does, the Worker's pool included.

/** A value as SQL writes it: text quoted, a number as it is, nothing as NULL. */
export function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

/** One row of an INSERT's values. */
export const sqlRow = (...values: (string | number | null)[]): string => `(${values.map(sqlLiteral).join(", ")})`;
