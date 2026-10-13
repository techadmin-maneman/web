// The carry-back file of a whole-database restore. Given the export taken just before going back to <T>, it writes
// the SQL that, run on the database as it was at <T>, makes each table as the export had it again, except the tables
// named to be left at <T>. D1 loads a long file as several transactions and checks foreign keys at the end of each, so
// no statement may leave a row pointing at one not there:
//
// - The export's rows go first into a bare copy of each table, which no key, check or trigger watches.
// - Then each table, after the tables it points at, has its rows added, or changed to match, in one statement.
// - Then each table, before the tables it points at, loses the rows gone since <T>; a table with a BEFORE DELETE
//   trigger that raises never does, and is only ever added to.
// - A table a trigger writes to is matched again last, once every trigger that writes to it has fired.
//
// What each table needs is read from the export's own schema, so a migration that adds a table or a trigger needs
// nothing here; test/worker/platform/restore-carry.test.ts runs it on a row in every table.

import { parentsFirst } from "../../src/lib/parents-first.ts";

/** Tables no restore touches: the migrations applied, the database's identity, the switch the restore runs under. */
const NEVER_CARRIED = ["d1_migrations", "deployment_identity", "maintenance"];
const NEVER_CARRIED_PREFIXES = ["sqlite_", "_cf_"];

/**
 * A line of D1's export that begins a statement; any other line continues the one before. The export writes each row
 * on one line, with any line break in a value written as `\n`, so only the schema's statements run over several.
 */
const STATEMENT_START = /^(PRAGMA |CREATE |INSERT INTO "|DELETE FROM sqlite_sequence;|ANALYZE )/;

const CREATE_TABLE = /^CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?/;
const INSERT_ROW = /^INSERT INTO "(\w+)" \(([^)]*)\) VALUES/;
const INSERT_INTO = /^INSERT INTO "\w+"/;
const TRIGGER_HEADER =
  /^CREATE TRIGGER (?:IF NOT EXISTS )?"?\w+"?\s+(?:(BEFORE|AFTER|INSTEAD\s+OF)\s+)?(DELETE|INSERT|UPDATE)\b[\s\S]*?\bON\s+"?(\w+)"?/i;
const WRITES = [
  /\b(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?/gi,
  /\bUPDATE\s+(?:OR\s+\w+\s+)?"?(\w+)"?\s+SET\b/gi,
  /\bDELETE\s+FROM\s+"?(\w+)"?/gi,
];

export interface ForeignKey {
  /** The table pointed at. */
  readonly table: string;
  readonly from: string;
  readonly to: string;
}

/** A table's keys, as scripts/lib/schema-keys.ts reads them from the export's schema. */
export interface TableKeys {
  /** The primary key's columns, in order; none for a table keyed only by its rowid. */
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly ForeignKey[];
}

export interface Carry {
  /** The carry-back file's statements, in the order they run. */
  readonly statements: readonly string[];
  /** Matched to the export: rows added, changed and deleted. */
  readonly matched: readonly string[];
  /** Only ever added to. */
  readonly addOnly: readonly string[];
  /** Written to by triggers, so emptied and written last. */
  readonly writtenByTriggers: readonly string[];
  /** The tables the restore is for, left as they were at <T>. */
  readonly left: readonly string[];
}

interface Row {
  readonly table: string;
  /** As the export quotes them: `"id"`. */
  readonly columns: readonly string[];
  readonly statement: string;
}

interface Trigger {
  readonly table: string;
  readonly refusesDelete: boolean;
  readonly writesTo: readonly string[];
}

interface Export {
  readonly tables: readonly string[];
  /** Each table's CREATE TABLE statement. */
  readonly schema: readonly string[];
  readonly triggers: readonly Trigger[];
  readonly rows: readonly Row[];
}

function isNeverCarried(table: string): boolean {
  if (NEVER_CARRIED.includes(table)) return true;
  return NEVER_CARRIED_PREFIXES.some((prefix) => table.startsWith(prefix));
}

function splitStatements(exported: string): string[] {
  const statements: string[] = [];
  for (const line of exported.split(/\r?\n/)) {
    const last = statements.length - 1;
    if (last < 0 || STATEMENT_START.test(line)) statements.push(line);
    else statements[last] = `${statements[last] ?? ""}\n${line}`;
  }
  return statements.map((statement) => statement.trim()).filter((statement) => statement !== "");
}

function rowOf(statement: string): Row | null {
  const match = INSERT_ROW.exec(statement);
  if (match === null) return null;
  const [, table = "", columns = ""] = match;
  return { table, columns: columns.split(","), statement };
}

function triggerOf(statement: string): Trigger | null {
  const header = TRIGGER_HEADER.exec(statement);
  if (header === null) return null;
  const [, timing = "BEFORE", event = "", table = ""] = header;
  const body = statement.slice(statement.search(/\bBEGIN\b/i));
  const refusesDelete =
    timing.toUpperCase() === "BEFORE" && event.toUpperCase() === "DELETE" && /\bRAISE\s*\(/i.test(body);
  const writesTo = WRITES.flatMap((pattern) => [...body.matchAll(pattern)].map((match) => match[1] ?? ""));
  return { table, refusesDelete, writesTo };
}

function readExport(exported: string): Export {
  const tables: string[] = [];
  const schema: string[] = [];
  const triggers: Trigger[] = [];
  const rows: Row[] = [];
  for (const statement of splitStatements(exported)) {
    const table = CREATE_TABLE.exec(statement)?.[1];
    if (table !== undefined) {
      tables.push(table);
      schema.push(statement);
      continue;
    }
    if (/^CREATE TRIGGER /i.test(statement)) {
      const trigger = triggerOf(statement);
      if (trigger === null) throw new Error(`a trigger the carry-back cannot read:\n${statement}`);
      triggers.push(trigger);
      continue;
    }
    const row = rowOf(statement);
    if (row !== null) rows.push(row);
  }
  return { tables, schema, triggers, rows };
}

/** The export's CREATE TABLE statements, for its tables' keys (scripts/lib/schema-keys.ts). */
export const createTablesIn = (exported: string): readonly string[] => readExport(exported).schema;

/** A trigger's rows in a table that is only ever added to could never be taken out again, so the carry would be wrong. */
function refuseTriggersIntoAddOnly(triggers: readonly Trigger[], addOnly: ReadonlySet<string>): void {
  for (const trigger of triggers) {
    const target = trigger.writesTo.find((table) => addOnly.has(table));
    if (target === undefined) continue;
    throw new Error(
      `${target} is only ever added to, and a trigger on ${trigger.table} writes to it: ` +
        "the carry-back would add rows the export does not have",
    );
  }
}

const copyOf = (table: string) => `"restore_carry_${table}"`;

/**
 * The table's rows that differ from the copy's changed to match, then the copy's rows it lacks added. Plain UPDATE
 * and INSERT, never an upsert: an upsert's conflict handling would overrule the INSERT OR REPLACE in its triggers.
 */
function matchRows(table: string, columns: readonly string[], primaryKey: readonly string[]): string[] {
  const list = columns.join(", ");
  const copy = `${copyOf(table)} AS copy`;
  const key = primaryKey.map((column) => `"${column}"`);
  const matching = (keyColumns: readonly string[], same: string) =>
    keyColumns.map((column) => `"${table}".${column} ${same} copy.${column}`).join(" AND ");
  const lacking = `WHERE NOT EXISTS (SELECT 1 FROM "${table}" WHERE ${key.length === 0 ? matching(columns, "IS") : matching(key, "=")});`;
  const add = `INSERT INTO "${table}" (${list}) SELECT ${list} FROM ${copy} ${lacking}`;
  const others = columns.filter((column) => !key.includes(column));
  if (key.length === 0 || others.length === 0) return [add];
  const change =
    `UPDATE "${table}" SET ${others.map((column) => `${column} = copy.${column}`).join(", ")} FROM ${copy} ` +
    `WHERE ${matching(key, "=")} AND (${others.map((column) => `"${table}".${column} IS NOT copy.${column}`).join(" OR ")});`;
  return [change, add];
}

/** The table's rows the copy lacks, gone since <T>, deleted; every row, where the export has none. */
function deleteGone(table: string, columns: readonly string[] | undefined, primaryKey: readonly string[]): string {
  if (columns === undefined) return `DELETE FROM "${table}";`;
  if (primaryKey.length === 0) {
    const same = columns.map((column) => `copy.${column} IS "${table}".${column}`).join(" AND ");
    return `DELETE FROM "${table}" WHERE NOT EXISTS (SELECT 1 FROM ${copyOf(table)} AS copy WHERE ${same});`;
  }
  const key = primaryKey.map((column) => `"${column}"`).join(", ");
  return `DELETE FROM "${table}" WHERE (${key}) NOT IN (SELECT ${key} FROM ${copyOf(table)});`;
}

/**
 * The carry-back file for an export, leaving the tables named as they were at <T>. `keys` are the export's tables'
 * primary and foreign keys, as scripts/lib/schema-keys.ts reads them.
 */
export function carryBack(
  exported: string,
  keys: ReadonlyMap<string, TableKeys>,
  leave: readonly string[] = [],
): Carry {
  const { tables, triggers, rows } = readExport(exported);
  const unknown = leave.filter((table) => !tables.includes(table));
  if (unknown.length > 0) throw new Error(`not a table in the export: ${unknown.join(", ")}`);

  const refusingDelete = new Set(triggers.filter((trigger) => trigger.refusesDelete).map((trigger) => trigger.table));
  refuseTriggersIntoAddOnly(triggers, refusingDelete);
  const triggerWritten = new Set(triggers.flatMap((trigger) => trigger.writesTo));

  const carried = tables.filter((table) => !isNeverCarried(table) && !leave.includes(table));
  const addOnly = carried.filter((table) => refusingDelete.has(table));
  const writtenByTriggers = carried.filter((table) => triggerWritten.has(table) && !refusingDelete.has(table));
  const matched = carried.filter((table) => !addOnly.includes(table));

  const carriedRows = rows.filter((row) => carried.includes(row.table));
  const columnsOf = new Map(carriedRows.map((row) => [row.table, row.columns]));
  const primaryKeyOf = (table: string) => keys.get(table)?.primaryKey ?? [];
  const match = (table: string) => {
    const columns = columnsOf.get(table);
    return columns === undefined ? [] : matchRows(table, columns, primaryKeyOf(table));
  };
  const gone = (table: string) => [deleteGone(table, columnsOf.get(table), primaryKeyOf(table))];
  const byForeignKeys = (names: readonly string[]) =>
    parentsFirst(names.map((name) => ({ name, parents: (keys.get(name)?.foreignKeys ?? []).map((key) => key.table) })));
  const byTriggers = parentsFirst(
    writtenByTriggers.map((name) => ({
      name,
      parents: triggers.filter((trigger) => trigger.writesTo.includes(name)).map((trigger) => trigger.table),
    })),
  );
  const copied = carried.filter((table) => columnsOf.has(table));

  const statements = [
    ...copied.map((table) => `CREATE TABLE ${copyOf(table)} AS SELECT * FROM "${table}" WHERE 0;`),
    ...carriedRows.map((row) => row.statement.replace(INSERT_INTO, `INSERT INTO ${copyOf(row.table)}`)),
    ...byForeignKeys(carried).flatMap(match),
    ...byForeignKeys(matched).toReversed().flatMap(gone),
    ...byTriggers.flatMap(match),
    ...byForeignKeys(writtenByTriggers).toReversed().flatMap(gone),
    ...copied.map((table) => `DROP TABLE ${copyOf(table)};`),
  ];
  return { statements, matched, addOnly, writtenByTriggers, left: [...leave] };
}
