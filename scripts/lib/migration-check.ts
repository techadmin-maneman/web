// Migrations are forward-only and must not break the code already deployed:
// expand, deploy, then contract in a later release. A contract step (a drop,
// rename or delete) must name the ADR that sequences it:
//
//   -- contract: docs/decisions/0042-drop-legacy-column.md
//
// See docs/decisions/0006-deployment-pipeline.md.

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

export interface MigrationCheckOptions {
  /** Migrations already on the base branch. They have run somewhere, so they must not change. */
  readonly atBase?: ReadonlyMap<string, string> | undefined;
  readonly adrExists?: (path: string) => boolean;
}

const FILE_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/; // 0001_create_leads.sql
const CONTRACT_ANNOTATION = /^--\s*contract:\s*(docs\/decisions\/\d{4}-[a-z0-9-]+\.md)\s*$/m;

/**
 * A migration that reached no environment can be withdrawn, and only withdrawn:
 * the deploy refused it and rolled it back, so there is nothing for a later
 * migration to correct and the next deploy would fail on the same statement.
 * The annotation names the run that refused it, and what is left must do
 * nothing, so this can never be a way to rewrite a migration that has run.
 *
 *   -- withdrawn: deploy-staging run 35816407888 refused it, and it has been applied nowhere.
 */
// Horizontal space only: \s would cross the newline and read the next line as the reason.
const WITHDRAWN_ANNOTATION = /^--[ \t]*withdrawn:[ \t]*\S.*$/m;

/** Comments, blank lines and the no-op a migration file needs to hold a statement. */
function doesNothing(sql: string): boolean {
  const statements = sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("--"));
  return statements.every((line) => /^select\s+1\s*;?$/i.test(line));
}

// CREATE TRIGGER name … BEGIN body END;, the body ending at the first line that is END; alone.
const TRIGGER_BODY = /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)[\s\S]*?\bBEGIN\b([\s\S]*?)^\s*END\s*;/gim;

const DESTRUCTIVE_STATEMENTS = [
  { pattern: /\bDROP\s+TABLE\b/i, label: "DROP TABLE" },
  { pattern: /\bDROP\s+VIEW\b/i, label: "DROP VIEW" },
  { pattern: /\bALTER\s+TABLE\s+\S+\s+DROP\b/i, label: "ALTER TABLE … DROP COLUMN" },
  { pattern: /\bALTER\s+TABLE\s+\S+\s+RENAME\b/i, label: "ALTER TABLE … RENAME" },
  { pattern: /\bDELETE\s+FROM\b/i, label: "DELETE FROM" },
];

/** The first migration the rules on comments and backfills hold for: those before it have run, and stay as they are. */
const WRITTEN_RULES_FROM = 101;

/** The most comment lines a migration opens with: what it does, in a few words. Its reasoning lives in its ADR. */
const HEADER_LINES = 5;

/** An open point's number, which goes wrong when the open points are renumbered, as on 27 September 2026. */
const OPEN_POINT = /\b(?:open[ -]points?\b[^\n]*?\b(?:item\s+)?\d+|item\s+\d+)\b/i;

/** One environment's own records, which belong in a script run there, never in every environment's schema. */
const TEST_DATA = /staging test|load test|tech-tester|tech-proof|STAGING_TEST/i;

/** The estimate a backfill of a whole table carries: "-- backfill: about 2,000 rows x (1 + 2 indexes)". */
const BACKFILL_ESTIMATE = /^--[ \t]*backfill:[ \t]*\S.*$/m;

export function checkMigrations(files: readonly MigrationFile[], options: MigrationCheckOptions = {}): string[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const problems: string[] = [];
  for (const [index, file] of sorted.entries()) {
    problems.push(...checkName(file, index + 1));
    problems.push(...checkDestructive(file, options.adrExists));
    problems.push(...checkTriggers(file));
    if (index + 1 >= WRITTEN_RULES_FROM) problems.push(...checkWriting(file));
  }
  if (options.atBase !== undefined) problems.push(...checkUnchanged(files, options.atBase));
  return problems;
}

/** Named NNNN_snake_case.sql and numbered 0001, 0002, … with no gaps. */
function checkName(file: MigrationFile, expectedNumber: number): string[] {
  const match = FILE_NAME.exec(file.name);
  if (match === null) return [`${file.name}: name must be NNNN_snake_case.sql`];

  const expected = String(expectedNumber).padStart(4, "0");
  if (match[1] !== expected) {
    return [`${file.name}: expected migration number ${expected}; numbers must be contiguous`];
  }
  return [];
}

/** A destructive statement needs a contract annotation naming an ADR that exists. */
function checkDestructive(file: MigrationFile, adrExists?: (path: string) => boolean): string[] {
  const found = DESTRUCTIVE_STATEMENTS.filter(({ pattern }) => pattern.test(withoutComments(file.sql)));
  if (found.length === 0) return [];

  const adr = CONTRACT_ANNOTATION.exec(file.sql)?.[1];
  if (adr === undefined) {
    const statements = found.map(({ label }) => label).join(", ");
    return [
      `${file.name}: ${statements} breaks the running version; ` +
        "ship it as a contract step with a '-- contract: docs/decisions/NNNN-….md' annotation",
    ];
  }
  if (adrExists !== undefined && !adrExists(adr)) {
    return [`${file.name}: contract annotation names ${adr}, which does not exist`];
  }
  return [];
}

/**
 * A trigger's body holds no CASE. Wrangler splits a migration into statements before remote D1 runs it and takes a
 * CASE's END for the trigger's own, and D1 then refuses the rest ("incomplete input"). The local database runs a
 * file whole, so only a deploy finds it: migration 0052 did. iif() says the same without an END.
 */
function checkTriggers(file: MigrationFile): string[] {
  const problems: string[] = [];
  for (const [, name = "", body = ""] of withoutComments(file.sql).matchAll(TRIGGER_BODY)) {
    if (/\bCASE\b/i.test(body)) {
      problems.push(
        `${file.name}: CASE inside the body of trigger ${name}; remote D1 refuses it (migration 0052), use iif()`,
      );
    }
  }
  return problems;
}

/**
 * A short header, no open point's number, no one environment's test data, and an estimate on a backfill of a whole
 * table: D1 stops a statement at 30 seconds, and the free plan allows 100,000 rows written a day (docs/migrations.md).
 */
function checkWriting(file: MigrationFile): string[] {
  const problems: string[] = [];
  const lines = file.sql.split("\n");
  const firstStatement = lines.findIndex((line) => line.trim() !== "" && !line.trim().startsWith("--"));
  const header = (firstStatement === -1 ? lines : lines.slice(0, firstStatement)).filter((line) =>
    line.trim().startsWith("--"),
  );
  if (header.length > HEADER_LINES) {
    problems.push(
      `${file.name}: ${String(header.length)} comment lines open it; at most ${String(HEADER_LINES)}, the rest in its ADR`,
    );
  }
  if (OPEN_POINT.test(file.sql))
    problems.push(`${file.name}: names an open point by number, which renumbering makes wrong`);
  if (TEST_DATA.test(withoutComments(file.sql))) {
    problems.push(`${file.name}: holds one environment's test data; write it from a script run there`);
  }
  if (backfillsAWholeTable(file.sql) && !BACKFILL_ESTIMATE.test(file.sql)) {
    problems.push(
      `${file.name}: backfills a whole table; estimate its writes in a "-- backfill:" line (docs/migrations.md)`,
    );
  }
  return problems;
}

/** An UPDATE with no WHERE, or an INSERT that copies from a SELECT: every row of a table, written. */
function backfillsAWholeTable(sql: string): boolean {
  const statements = withoutComments(sql).split(";");
  return statements.some(
    (statement) =>
      (/\bUPDATE\s+\w+\s+SET\b/i.test(statement) && !/\bWHERE\b/i.test(statement)) ||
      /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+\w+(?:\s*\([^)]*\))?\s*SELECT\b/i.test(statement),
  );
}

const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** A migration edited down to nothing, with the run that refused it named. */
function withdrawn(sql: string): boolean {
  return WITHDRAWN_ANNOTATION.test(sql) && doesNothing(sql);
}

/**
 * Migrations given a new number before any environment applied them, old name to new. Two pull requests landed a
 * 0077 together while staging stood at 0076.
 */
const RENUMBERED: ReadonlyMap<string, string> = new Map([["0077_consents_shown.sql", "0078_consents_shown.sql"]]);

/** Every migration on the base branch is still here, byte for byte, unless it was withdrawn or renumbered. */
function checkUnchanged(files: readonly MigrationFile[], atBase: ReadonlyMap<string, string>): string[] {
  const current = new Map(files.map((file) => [file.name, file.sql]));
  const problems: string[] = [];
  for (const [name, sqlAtBase] of atBase) {
    const sqlNow = current.get(name);
    const renumberedAs = RENUMBERED.get(name);
    if (sqlNow === undefined && renumberedAs !== undefined && current.has(renumberedAs)) continue;
    if (sqlNow === undefined) {
      problems.push(`${name}: applied migrations must not be deleted`);
    } else if (sqlNow !== sqlAtBase && !withdrawn(sqlNow)) {
      problems.push(
        `${name}: applied migrations must not be edited; add a new migration, ` +
          "or, if no environment ever applied this one, withdraw it with a " +
          "'-- withdrawn: <the run that refused it>' annotation and nothing left to do",
      );
    }
  }
  return problems;
}
