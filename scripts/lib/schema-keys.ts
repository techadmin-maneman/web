// Each table's primary key and foreign keys, as SQLite reads them from the schema's own CREATE TABLE statements: what
// a restore orders its rows by (backup-restore.ts, restore-carry.ts), since D1 checks foreign keys as a file loads.

import { DatabaseSync } from "node:sqlite";
import type { TableKeys } from "./restore-carry.ts";

export function keysOf(createTables: readonly string[]): Map<string, TableKeys> {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const sql of createTables) sqlite.exec(sql.trimEnd().endsWith(";") ? sql : `${sql};`);
    const names = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")
      .all() as { name: string }[];
    const primary = sqlite.prepare("SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk");
    const foreign = sqlite.prepare(`SELECT "table", "from", "to" FROM pragma_foreign_key_list(?)`);
    const primaryKeys = new Map(
      names.map(({ name }) => [name, (primary.all(name) as { name: string }[]).map((column) => column.name)]),
    );
    return new Map(
      names.map(({ name }) => {
        const keys = foreign.all(name) as { table: string; from: string; to: string | null }[];
        // A key naming no column points at the other table's primary key.
        const foreignKeys = keys.map((key) => ({ ...key, to: key.to ?? primaryKeys.get(key.table)?.[0] ?? "rowid" }));
        return [name, { primaryKey: primaryKeys.get(name) ?? [], foreignKeys }];
      }),
    );
  } finally {
    sqlite.close();
  }
}
