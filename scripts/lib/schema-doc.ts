// docs/schema.md, written from the migrations themselves: they are applied in
// order to an empty database, and each table is read back as they leave it
// (npm run schema; test/node/database/schema-doc.test.ts). What a table is for is the
// one thing the schema cannot say, so it is written once here, and the test
// fails on a table that has no line or a line whose table is gone.

import { RESTORE_GROUPS, type RestoreGroup } from "./restore-groups.ts";
import { DatabaseSync } from "node:sqlite";
import { PURPOSES } from "./schema-purposes.ts";
import { columnNotes } from "./column-notes.ts";

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

export interface Column {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
  readonly primaryKey: boolean;
  /** "people.id" for a column that points at another table's. */
  readonly references: string | null;
  /** What it holds, as the migrations' comment on it says; empty where none does. */
  readonly note: string;
}

export interface Index {
  /** "(unique)" for one a UNIQUE constraint made. */
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
  /** A partial index's condition. */
  readonly where: string | null;
}

export interface Table {
  readonly name: string;
  readonly createdIn: string;
  readonly changedIn: readonly string[];
  readonly columns: readonly Column[];
  readonly indexes: readonly Index[];
  readonly triggers: readonly string[];
}

/** The `_at` columns that hold a calendar day, not an instant, and how each is read. */
export const DAY_VALUED_AT: Readonly<Record<string, string>> = {
  "pieces.fitted_at":
    "The day FSM's asset says the piece was installed (`Installation_Date`), or the day the technician's app fitted it (`src/domain/inventory/pieces.ts`).",
  "pieces.replacement_due_at":
    "The fitted day plus the base's cycle; the Tasks board reads it as midnight in India on that day (`instantOf`, `src/domain/ops/tasks.ts`).",
};

const TABLES_READ = `SELECT name, sql FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
  ORDER BY name`;

interface Row {
  readonly name: string;
  readonly sql: string;
}

/** A table's own statement, its indexes' and its triggers': what a migration changes when it changes the table. */
function signature(db: DatabaseSync, table: string): string {
  const parts = db
    .prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type, name")
    .all(table) as unknown as { sql: string }[];
  return parts.map((part) => part.sql).join("\n");
}

function columnsOf(db: DatabaseSync, table: string): Omit<Column, "note">[] {
  const keys = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as unknown as {
    from: string;
    table: string;
    to: string | null;
  }[];
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }[];
  return info.map((column) => {
    const key = keys.find((each) => each.from === column.name);
    return {
      name: column.name,
      type: column.type,
      notNull: column.notnull === 1,
      defaultValue: column.dflt_value,
      primaryKey: column.pk > 0,
      references: key === undefined ? null : `${key.table}.${key.to ?? "rowid"}`,
    };
  });
}

function indexesOf(db: DatabaseSync, table: string): Index[] {
  const list = db.prepare(`PRAGMA index_list("${table}")`).all() as unknown as {
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }[];
  return list
    .filter((index) => index.origin !== "pk")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((index) => {
      const columns = (db.prepare(`PRAGMA index_info("${index.name}")`).all() as unknown as { name: string }[]).map(
        (column) => column.name,
      );
      const sql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(index.name) as { sql: string | null } | undefined
      )?.sql;
      const where = index.partial === 1 && sql ? (/\bWHERE\s+([\s\S]+?)\s*;?\s*$/i.exec(sql)?.[1] ?? null) : null;
      return {
        name: index.origin === "u" ? "(unique)" : index.name,
        unique: index.unique === 1,
        columns,
        where: where === null ? null : where.replace(/\s+/g, " "),
      };
    });
}

function triggersOf(db: DatabaseSync, table: string): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name")
    .all(table) as unknown as { name: string }[];
  return rows.map((row) => row.name);
}

/** Every table the migrations leave, with the migration that made it and those that changed it since. */
export function migratedTables(migrations: readonly MigrationFile[]): Table[] {
  const notes = columnNotes(migrations);
  const db = new DatabaseSync(":memory:");
  const history = new Map<string, { createdIn: string; changedIn: string[]; signature: string }>();
  for (const migration of migrations) {
    db.exec(migration.sql);
    const present = db.prepare(TABLES_READ).all() as unknown as Row[];
    for (const name of [...history.keys()]) {
      if (!present.some((row) => row.name === name)) history.delete(name);
    }
    for (const { name } of present) {
      const now = signature(db, name);
      const known = history.get(name);
      if (known === undefined) history.set(name, { createdIn: migration.name, changedIn: [], signature: now });
      else if (known.signature !== now)
        history.set(name, { ...known, changedIn: [...known.changedIn, migration.name], signature: now });
    }
  }
  return [...history.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { createdIn, changedIn }]) => ({
      name,
      createdIn,
      changedIn,
      columns: columnsOf(db, name).map((column) => ({ ...column, note: notes.get(`${name}.${column.name}`) ?? "" })),
      indexes: indexesOf(db, name),
      triggers: triggersOf(db, name),
    }));
}

const code = (text: string): string => `\`${text}\``;

function columnRow(column: Column): string {
  const reference = column.references === null ? [] : [`→ ${code(column.references)}`];
  const notes = [...(column.primaryKey ? ["primary key"] : []), ...reference];
  const empty = column.notNull || column.primaryKey ? "no" : "yes";
  const fallback = column.defaultValue === null ? "" : code(column.defaultValue);
  const meaning = column.note.replace(/\|/g, "\\|");
  return `| ${code(column.name)} | ${column.type || "any"} | ${empty} | ${fallback} | ${notes.join("; ")} | ${meaning} |`;
}

function indexLine(index: Index): string {
  const kind = index.unique ? "unique on" : "on";
  const where = index.where === null ? "" : `, where ${code(index.where)}`;
  const name = index.name === "(unique)" ? "A `UNIQUE` constraint" : code(index.name);
  return `- ${name}: ${kind} (${index.columns.map(code).join(", ")})${where}`;
}

function tableSection(table: Table): string[] {
  const changed = table.changedIn.length === 0 ? "" : `; changed by ${table.changedIn.map(code).join(", ")}`;
  return [
    `## ${table.name}`,
    "",
    PURPOSES[table.name] ?? "",
    "",
    `Made by ${code(table.createdIn)}${changed}.`,
    "",
    "| Column | Type | May be empty | Default | Key | What it holds |",
    "| --- | --- | --- | --- | --- | --- |",
    ...table.columns.map(columnRow),
    "",
    ...(table.indexes.length === 0 ? [] : ["Indexes:", "", ...table.indexes.map(indexLine), ""]),
    ...(table.triggers.length === 0 ? [] : [`Triggers: ${table.triggers.map(code).join(", ")}.`, ""]),
  ];
}

const restoreGroupRow = (group: RestoreGroup): string =>
  `| ${group.what} | ${group.tables.map(code).join(", ")} | ${group.leftAtT} | ${group.putBackBy} |`;

function restoreSection(): string[] {
  return [
    "## What a restore undoes",
    "",
    'What each group of tables means if it is left as it was at `<T>`, and how it is put back (`docs/runbook.md`, "Restoring D1"). A table may be in more than one group. Every table is in one: the test fails on a table that is not, until it is added to `RESTORE_GROUPS` (`scripts/lib/restore-groups.ts`).',
    "",
    "| What | Tables | Left at `<T>` | Put back by |",
    "| --- | --- | --- | --- |",
    ...RESTORE_GROUPS.map(restoreGroupRow),
    "",
  ];
}

export function schemaDoc(tables: readonly Table[]): string {
  return [
    "# The database schema",
    "",
    "What each table in D1 holds, as the migrations leave it. This file is written by `npm run schema`, which applies `migrations/` in order to an empty database and reads every table back; `test/node/database/schema-doc.test.ts` fails until it is run after a migration changes a table. How to write a migration is `docs/migrations.md`.",
    "",
    "## Times and dates",
    "",
    "A column ending `_at` holds an instant, as ISO 8601 in UTC (`2026-09-27T06:30:00.000Z`). One ending `_date` holds a calendar day in India, `YYYY-MM-DD`, and a day is never cut from an instant's UTC string: it is read as India's date (`src/lib/india-time.ts`). Two `_at` columns hold a day, from before the rule was written (`docs/migrations.md`, rule 7):",
    "",
    ...Object.entries(DAY_VALUED_AT).map(([column, how]) => `- ${code(column)}: ${how}`),
    "",
    ...restoreSection(),
    "## Tables",
    "",
    ...tables.map((table) => `- [${table.name}](#${table.name}): ${PURPOSES[table.name] ?? ""}`),
    "",
    ...tables.flatMap(tableSection),
  ].join("\n");
}
