// The real migration files applied to an in-memory SQLite database as D1 applies them: each in a transaction of its
// own, with foreign keys enforced.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const MIGRATIONS: readonly string[] = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

/** The one migration file whose name holds `part`, as "0044_" or "_retire_generic_first_fit.sql". */
export function migrationNamed(part: string): string {
  const found = MIGRATIONS.filter((file) => file.includes(part));
  if (found.length !== 1) throw new Error(`${String(found.length)} migrations are named ${part}`);
  return found[0] ?? "";
}

export function apply(db: DatabaseSync, file: string): void {
  db.exec("BEGIN");
  db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec("COMMIT");
}

/** A database with every migration before `file` applied. */
export function databaseBefore(file: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const earlier of MIGRATIONS.filter((name) => name < file)) apply(db, earlier);
  return db;
}

/** A database with every migration up to `file` applied, `file` too: all of them unless one is named. */
export function databaseThrough(file = MIGRATIONS.at(-1) ?? ""): DatabaseSync {
  const db = databaseBefore(file);
  apply(db, file);
  return db;
}
