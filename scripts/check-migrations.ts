// Checks migrations/ against the rules in scripts/lib/migration-check.ts.
//
//   node scripts/check-migrations.ts                     numbering and destructive statements
//   node scripts/check-migrations.ts --base origin/main  also: no migration on origin/main was edited or deleted

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkMigrations, type MigrationFile } from "./lib/migration-check.ts";

const MIGRATIONS_DIR = "migrations";

/** Windows checkouts may have CRLF line endings; compare content, not line endings. */
function withUnixLineEndings(sql: string): string {
  return sql.replace(/\r\n/g, "\n");
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

/** The migrations as they are on `base`, by file name. */
function migrationsOn(base: string): Map<string, string> {
  git("rev-parse", "--verify", "--quiet", `${base}^{commit}`); // throws if `base` is not a commit

  const migrations = new Map<string, string>();
  try {
    execFileSync("git", ["cat-file", "-e", `${base}:${MIGRATIONS_DIR}`], { stdio: "ignore" });
  } catch {
    return migrations; // `base` is older than the migrations directory
  }

  for (const name of git("ls-tree", "--name-only", `${base}:${MIGRATIONS_DIR}`).split("\n")) {
    if (!name.endsWith(".sql")) continue;
    migrations.set(name, withUnixLineEndings(git("show", `${base}:${MIGRATIONS_DIR}/${name}`)));
  }
  return migrations;
}

const { values } = parseArgs({ options: { base: { type: "string" } } });

const files: MigrationFile[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, sql: withUnixLineEndings(readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8")) }));

const atBase = values.base === undefined ? undefined : migrationsOn(values.base);
const problems = checkMigrations(files, { atBase, adrExists: existsSync });

if (problems.length > 0) {
  console.error(`migration check failed (${String(problems.length)} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
const unchanged = values.base === undefined ? "" : `, none changed since ${values.base}`;
console.log(`migration check passed: ${String(files.length)} migration(s)${unchanged}`);
