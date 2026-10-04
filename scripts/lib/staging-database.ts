// Staging's own database, read and written through wrangler from a script run by hand. Staging only: every call names
// maneman-staging and passes --env staging.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATABASE = "maneman-staging";

function wrangler(args: readonly string[]): string {
  return execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", DATABASE, "--remote", "--env", "staging", ...args],
    { encoding: "utf8" },
  );
}

/** The rows one statement answers. */
export function queryStaging<T>(sql: string): T[] {
  const output = wrangler(["--json", "--command", sql]);
  // wrangler prints its banner before the JSON when the terminal is not a TTY.
  const answers = JSON.parse(output.slice(output.indexOf("["))) as { results: T[] }[];
  return answers[0]?.results ?? [];
}

/** Runs the statements as one file. */
export function runOnStaging(statements: readonly string[]): void {
  const folder = mkdtempSync(join(tmpdir(), "mm-staging-"));
  try {
    const path = join(folder, "statements.sql");
    writeFileSync(path, statements.join("\n"));
    wrangler(["--file", path, "--yes"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
