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
  const sqlWithoutComments = file.sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = DESTRUCTIVE_STATEMENTS.filter(({ pattern }) => pattern.test(sqlWithoutComments));
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

/** Every migration on the base branch is still here, byte for byte. */
function checkUnchanged(files: readonly MigrationFile[], atBase: ReadonlyMap<string, string>): string[] {
  const current = new Map(files.map((file) => [file.name, file.sql]));
  const problems: string[] = [];
  for (const [name, sqlAtBase] of atBase) {
    const sqlNow = current.get(name);
    if (sqlNow === undefined) problems.push(`${name}: applied migrations must not be deleted`);
    else if (sqlNow !== sqlAtBase) problems.push(`${name}: applied migrations must not be edited; add a new migration`);
  }
  return problems;
}
