//   node scripts/check-migrations.ts                    numbering and destructive-statement rules
//   node scripts/check-migrations.ts --base origin/main also: migrations on <base> are unchanged

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkMigrations, type MigrationFile } from "./lib/migration-check.ts";

const DIR = "migrations";
const { values } = parseArgs({ options: { base: { type: "string" } } });

const normalise = (sql: string): string => sql.replace(/\r\n/g, "\n");

const files: MigrationFile[] = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, sql: normalise(readFileSync(`${DIR}/${name}`, "utf8")) }));

let atBase: Map<string, string> | undefined;
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" });

function existsAtBase(base: string): boolean {
  git("rev-parse", "--verify", "--quiet", `${base}^{commit}`); // throws on a bad ref
  try {
    execFileSync("git", ["cat-file", "-e", `${base}:${DIR}`], { stdio: "ignore" });
    return true;
  } catch {
    return false; // the base predates the migrations directory
  }
}

if (values.base !== undefined) {
  const base = values.base;
  const listed = existsAtBase(base) ? git("ls-tree", "--name-only", `${base}:${DIR}`) : "";
  atBase = new Map(
    listed
      .split("\n")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => [name, normalise(git("show", `${base}:${DIR}/${name}`))]),
  );
}

const problems = checkMigrations(files, { ...(atBase === undefined ? {} : { atBase }), adrExists: existsSync });
if (problems.length > 0) {
  console.error(`migration check failed (${String(problems.length)} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `migration check passed: ${String(files.length)} migration(s)${values.base === undefined ? "" : `, none changed since ${values.base}`}`,
);
