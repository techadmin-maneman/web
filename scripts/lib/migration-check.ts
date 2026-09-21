// Migrations are forward-only and must not break the code already deployed:
// expand, deploy, then contract in a later release. A contract step (a drop or
// rename) must name the ADR that sequences it:
//
//   -- contract: docs/decisions/0042-drop-legacy-column.md
//
// See docs/decisions/0006-deployment-pipeline.md.

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

const FILE_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
const CONTRACT_ANNOTATION = /^--\s*contract:\s*(docs\/decisions\/\d{4}-[a-z0-9-]+\.md)\s*$/m;

const DESTRUCTIVE: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /\bDROP\s+TABLE\b/i, what: "DROP TABLE" },
  { pattern: /\bDROP\s+VIEW\b/i, what: "DROP VIEW" },
  { pattern: /\bALTER\s+TABLE\s+\S+\s+DROP\b/i, what: "ALTER TABLE … DROP COLUMN" },
  { pattern: /\bALTER\s+TABLE\s+\S+\s+RENAME\b/i, what: "ALTER TABLE … RENAME" },
  { pattern: /\bDELETE\s+FROM\b/i, what: "DELETE FROM" },
];

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function checkMigrations(
  files: readonly MigrationFile[],
  options: {
    /** Migrations on the base branch: already applied somewhere, so immutable. */
    readonly atBase?: ReadonlyMap<string, string>;
    readonly adrExists?: (path: string) => boolean;
  } = {},
): string[] {
  const problems: string[] = [];
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach((file, index) => {
    const match = FILE_NAME.exec(file.name);
    if (match === null) {
      problems.push(`${file.name}: name must be NNNN_snake_case.sql`);
      return;
    }
    const expected = String(index + 1).padStart(4, "0");
    if (match[1] !== expected)
      problems.push(`${file.name}: expected migration number ${expected}; numbers must be contiguous`);

    const body = stripComments(file.sql);
    const destructive = DESTRUCTIVE.filter(({ pattern }) => pattern.test(body));
    if (destructive.length > 0) {
      const annotation = CONTRACT_ANNOTATION.exec(file.sql);
      const adr = annotation?.[1];
      if (adr === undefined) {
        problems.push(
          `${file.name}: ${destructive.map((d) => d.what).join(", ")} breaks the running version; ` +
            "ship it as a contract step with a '-- contract: docs/decisions/NNNN-….md' annotation",
        );
      } else if (options.adrExists !== undefined && !options.adrExists(adr)) {
        problems.push(`${file.name}: contract annotation names ${adr}, which does not exist`);
      }
    }
  });

  if (options.atBase !== undefined) {
    const current = new Map(files.map((f) => [f.name, f.sql]));
    for (const [name, sql] of options.atBase) {
      const now = current.get(name);
      if (now === undefined) problems.push(`${name}: applied migrations must not be deleted`);
      else if (now !== sql) problems.push(`${name}: applied migrations must not be edited; add a new migration`);
    }
  }
  return problems;
}
