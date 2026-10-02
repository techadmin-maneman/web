// The carry-back file of a whole-database restore. Given the export taken just before going back to <T>, it writes
// the SQL that, run on the database as it was at <T>, makes each table as the export had it again, except the tables
// named to be left at <T>. What each table needs is read from the export's own schema, so a migration that adds a
// table or a trigger needs nothing here; test/worker/restore-carry.test.ts runs it on a row in every table.
//
// - A table with a BEFORE DELETE trigger that raises is only ever added to. None of its rows is deleted: each of the
//   export's is added, or, where the row is there already and has changed since, changed to match.
// - A table a trigger writes to is emptied and written as the export had it, last, once every trigger that writes to
//   it has fired.
// - Every other table is emptied and written again.

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
const TRIGGER_HEADER =
  /^CREATE TRIGGER (?:IF NOT EXISTS )?"?\w+"?\s+(?:(BEFORE|AFTER|INSTEAD\s+OF)\s+)?(DELETE|INSERT|UPDATE)\b[\s\S]*?\bON\s+"?(\w+)"?/i;
const WRITES = [
  /\b(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?/gi,
  /\bUPDATE\s+(?:OR\s+\w+\s+)?"?(\w+)"?\s+SET\b/gi,
  /\bDELETE\s+FROM\s+"?(\w+)"?/gi,
];

export interface Carry {
  /** The carry-back file's statements, in the order they run. */
  readonly statements: readonly string[];
  /** Emptied and written again. */
  readonly rewritten: readonly string[];
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
  const triggers: Trigger[] = [];
  const rows: Row[] = [];
  for (const statement of splitStatements(exported)) {
    const table = CREATE_TABLE.exec(statement)?.[1];
    if (table !== undefined) {
      tables.push(table);
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
  return { tables, triggers, rows };
}

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

/** The row added, or, where it is there already and differs, changed to match: never a delete. */
function addOrMatch(row: Row): string {
  const set = row.columns.map((column) => `${column} = excluded.${column}`).join(", ");
  const differs = row.columns.map((column) => `${column} IS NOT excluded.${column}`).join(" OR ");
  return `${row.statement.replace(/;$/, "")} ON CONFLICT DO UPDATE SET ${set} WHERE ${differs};`;
}

const deleteAll = (table: string) => `DELETE FROM "${table}";`;

/** The carry-back file for an export, leaving the tables named as they were at <T>. */
export function carryBack(exported: string, leave: readonly string[] = []): Carry {
  const { tables, triggers, rows } = readExport(exported);
  const unknown = leave.filter((table) => !tables.includes(table));
  if (unknown.length > 0) throw new Error(`not a table in the export: ${unknown.join(", ")}`);

  const refusingDelete = new Set(triggers.filter((trigger) => trigger.refusesDelete).map((trigger) => trigger.table));
  refuseTriggersIntoAddOnly(triggers, refusingDelete);
  const triggerWritten = new Set(triggers.flatMap((trigger) => trigger.writesTo));

  const carried = tables.filter((table) => !isNeverCarried(table) && !leave.includes(table));
  const addOnly = carried.filter((table) => refusingDelete.has(table));
  const writtenByTriggers = carried.filter((table) => triggerWritten.has(table) && !refusingDelete.has(table));
  const rewritten = carried.filter((table) => !addOnly.includes(table) && !writtenByTriggers.includes(table));

  const rowsOf = (wanted: readonly string[]) => rows.filter((row) => wanted.includes(row.table));
  const firstRows = rowsOf([...rewritten, ...addOnly]).map((row) =>
    addOnly.includes(row.table) ? addOrMatch(row) : row.statement,
  );
  const statements = [
    "PRAGMA defer_foreign_keys = true;",
    ...rewritten.map(deleteAll),
    ...firstRows,
    ...writtenByTriggers.map(deleteAll),
    ...rowsOf(writtenByTriggers).map((row) => row.statement),
  ];
  return { statements, rewritten, addOnly, writtenByTriggers, left: [...leave] };
}
