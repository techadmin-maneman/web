// The carry-back file of a whole-database restore (docs/runbook.md, "Restoring the whole database"). Given the export
// taken just before going back to <T>, it writes the SQL that, run on the database as it was at <T>, makes each table
// as the export had it again, except the tables the restore is for. What each table needs is read from the export's
// own schema, so a migration that adds a table or a trigger needs nothing here:
//
// - A table with a BEFORE DELETE trigger that raises is only ever added to. None of its rows is deleted: each of the
//   export's is added, or, where the row is there already and has changed since, changed to match.
// - A table that a trigger on another table inserts into, such as last_visits, is worked out from that table. Its
//   triggers rewrite it while the rest is carried back, so it is emptied and written as the export had it last.
// - Every other table is emptied and written again.

/** Tables no restore touches: the migrations applied, the database's identity, and SQLite's and Cloudflare's own. */
const NEVER_CARRIED = ["d1_migrations", "deployment_identity"];
const NEVER_CARRIED_PREFIXES = ["sqlite_", "_cf_"];

/** A line of the export that begins a statement; any other line continues the one before. */
const STATEMENT_START = /^(PRAGMA |CREATE |INSERT INTO "|DELETE FROM |ANALYZE )/;

const CREATE_TABLE = /^CREATE TABLE (?:IF NOT EXISTS )?"?([A-Za-z0-9_]+)"?/;
const INSERT_ROW = /^INSERT INTO "([A-Za-z0-9_]+)" \(([^)]*)\) VALUES/;
const TRIGGER_HEADER =
  /^CREATE TRIGGER (?:IF NOT EXISTS )?"?\w+"?\s+(BEFORE|AFTER|INSTEAD OF)\s+(DELETE|INSERT|UPDATE)\b[\s\S]*?\bON\s+"?(\w+)"?/i;
const INSERT_TARGET = /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?/gi;

export interface Carry {
  /** The carry-back file's statements, in the order they run. */
  readonly statements: readonly string[];
  /** Emptied and written again. */
  readonly rewritten: readonly string[];
  /** Only ever added to. */
  readonly addOnly: readonly string[];
  /** Worked out by triggers from other tables, and written last. */
  readonly keptByTriggers: readonly string[];
  /** The tables the restore is for, left as they were at <T>. */
  readonly left: readonly string[];
}

interface Row {
  readonly table: string;
  readonly columns: readonly string[];
  readonly statement: string;
}

interface Schema {
  readonly tables: readonly string[];
  readonly addOnly: ReadonlySet<string>;
  readonly keptByTriggers: ReadonlySet<string>;
  readonly rows: readonly Row[];
}

function isNeverCarried(table: string): boolean {
  if (NEVER_CARRIED.includes(table)) return true;
  return NEVER_CARRIED_PREFIXES.some((prefix) => table.startsWith(prefix));
}

function splitStatements(exported: string): string[] {
  const statements: string[] = [];
  for (const line of exported.split("\n")) {
    const last = statements.length - 1;
    if (STATEMENT_START.test(line) || last < 0) statements.push(line);
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

/** What a trigger says of the tables: one it keeps from being deleted from, and the others it inserts into. */
function readTrigger(statement: string): { refusesDelete: string | null; fills: string[] } {
  const header = TRIGGER_HEADER.exec(statement);
  if (header === null) return { refusesDelete: null, fills: [] };
  const [, timing = "", event = "", table = ""] = header;
  const body = statement.slice(statement.search(/\bBEGIN\b/i));
  const raises = /\bRAISE\s*\(/i.test(body);
  const refusesDelete = timing.toUpperCase() === "BEFORE" && event.toUpperCase() === "DELETE" && raises ? table : null;
  const fills = [...body.matchAll(INSERT_TARGET)].map((match) => match[1] ?? "").filter((target) => target !== table);
  return { refusesDelete, fills };
}

function readSchema(exported: string): Schema {
  const tables: string[] = [];
  const addOnly = new Set<string>();
  const keptByTriggers = new Set<string>();
  const rows: Row[] = [];
  for (const statement of splitStatements(exported)) {
    const table = CREATE_TABLE.exec(statement)?.[1];
    if (table !== undefined) {
      tables.push(table);
      continue;
    }
    if (/^CREATE TRIGGER /i.test(statement)) {
      const { refusesDelete, fills } = readTrigger(statement);
      if (refusesDelete !== null) addOnly.add(refusesDelete);
      for (const target of fills) keptByTriggers.add(target);
      continue;
    }
    const row = rowOf(statement);
    if (row !== null) rows.push(row);
  }
  return { tables, addOnly, keptByTriggers, rows };
}

/** The row added, or, where it is there already and differs, changed to match: never a delete. */
function addOrMatch(row: Row): string {
  const set = row.columns.map((column) => `${column} = excluded.${column}`).join(", ");
  const differs = row.columns.map((column) => `${column} IS NOT excluded.${column}`).join(" OR ");
  return `${row.statement.replace(/;$/, "")} ON CONFLICT DO UPDATE SET ${set} WHERE ${differs};`;
}

const deleteAll = (table: string) => `DELETE FROM "${table}";`;

/** The carry-back file for an export, leaving the tables named as they were at <T>. */
export function carryBack(exported: string, leave: readonly string[] = []): Carry {
  const schema = readSchema(exported);
  const unknown = leave.filter((table) => !schema.tables.includes(table));
  if (unknown.length > 0) throw new Error(`not a table in the export: ${unknown.join(", ")}`);

  const carried = schema.tables.filter((table) => !isNeverCarried(table) && !leave.includes(table));
  const addOnly = carried.filter((table) => schema.addOnly.has(table));
  const keptByTriggers = carried.filter((table) => schema.keptByTriggers.has(table) && !schema.addOnly.has(table));
  const rewritten = carried.filter((table) => !addOnly.includes(table) && !keptByTriggers.includes(table));

  const rowsOf = (tables: readonly string[]) => schema.rows.filter((row) => tables.includes(row.table));
  const statements = [
    "PRAGMA defer_foreign_keys = true;",
    ...rewritten.map(deleteAll),
    ...rowsOf([...rewritten, ...addOnly]).map((row) => (addOnly.includes(row.table) ? addOrMatch(row) : row.statement)),
    ...keptByTriggers.map(deleteAll),
    ...rowsOf(keptByTriggers).map((row) => row.statement),
  ];
  return { statements, rewritten, addOnly, keptByTriggers, left: [...leave] };
}
