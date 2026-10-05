// A database a script reads or writes, through wrangler: the local one by its binding, a deployed one by its name and
// its environment. Statements go as a file, never through the shell's quoting.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_DATABASE_NAME, type EnvironmentName } from "../../src/config/environments.ts";

const WRANGLER = "node_modules/wrangler/bin/wrangler.js";

function targetOf(environment: EnvironmentName): string[] {
  if (environment === "local") return ["DB", "--local", "--env="];
  return [EXPECTED_DATABASE_NAME[environment], "--remote", "--env", environment];
}

/** The rows one statement answers. */
export function d1Query<T>(environment: EnvironmentName, sql: string): T[] {
  const output = execFileSync(
    process.execPath,
    [WRANGLER, "d1", "execute", ...targetOf(environment), "--json", "--command", sql],
    { encoding: "utf8" },
  );
  // wrangler prints its banner before the JSON when the terminal is not a TTY.
  const answers = JSON.parse(output.slice(output.indexOf("["))) as { results: T[] }[];
  return answers[0]?.results ?? [];
}

/** Runs the statements as one file. `show` passes wrangler's own report of it through to the terminal. */
export function d1Execute(environment: EnvironmentName, statements: readonly string[], show = false): void {
  const folder = mkdtempSync(join(tmpdir(), "mm-d1-"));
  try {
    const file = join(folder, "statements.sql");
    writeFileSync(file, statements.join("\n"));
    execFileSync(process.execPath, [WRANGLER, "d1", "execute", ...targetOf(environment), "--file", file, "--yes"], {
      stdio: show ? "inherit" : "pipe",
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
