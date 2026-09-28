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

export function checkMigrations(files: readonly MigrationFile[], options: MigrationCheckOptions = {}): string[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const problems: string[] = [];
  for (const [index, file] of sorted.entries()) {
    problems.push(...checkName(file, index + 1));
    problems.push(...checkDestructive(file, options.adrExists));
    problems.push(...checkTriggers(file));
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

const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** A migration edited down to nothing, with the run that refused it named. */
function withdrawn(sql: string): boolean {
  return WITHDRAWN_ANNOTATION.test(sql) && doesNothing(sql);
}

/** Every migration on the base branch is still here, byte for byte, unless it was withdrawn. */
function checkUnchanged(files: readonly MigrationFile[], atBase: ReadonlyMap<string, string>): string[] {
  const current = new Map(files.map((file) => [file.name, file.sql]));
  const problems: string[] = [];
  for (const [name, sqlAtBase] of atBase) {
    const sqlNow = current.get(name);
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
