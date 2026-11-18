// npm run audit
//
// CI's dependency audit: fails on any high or critical advisory except those scripts/lib/audit.ts lets through, and on
// any at all in the production dependencies, the ones that ship: an allowance is for a tool that runs only in
// development or CI, so it never lets through a copy that reaches a user or a Worker.

import { spawnSync } from "node:child_process";
import { ALLOWED, failingAdvisories, type Allowance, type AuditReport } from "../lib/audit.ts";

const today = new Date().toISOString().slice(0, 10);

/** What fails in one audit, under the allowances given. */
function failing(command: string, allowed: readonly Allowance[]): string[] {
  // npm audit exits 1 whenever it finds anything, so its exit code says nothing here; its JSON does.
  // One command string: npm is npm.cmd on Windows, which Node starts only through a shell.
  const run = spawnSync(command, { encoding: "utf8", shell: true });
  if (run.stdout.trim() === "") {
    console.error(run.stderr);
    process.exit(1);
  }
  return failingAdvisories(JSON.parse(run.stdout) as AuditReport, today, allowed);
}

const everything = failing("npm audit --json", ALLOWED);
const shipped = failing("npm audit --omit=dev --json", []);
if (everything.length > 0 || shipped.length > 0) {
  const lines = (list: string[]) => list.map((line) => `  ${line}`).join("\n");
  if (everything.length > 0) console.error(`High or critical advisories:\n${lines(everything)}`);
  if (shipped.length > 0)
    console.error(`High or critical advisories in what ships, none let through:\n${lines(shipped)}`);
  process.exit(1);
}
console.log(
  "No high or critical advisory: none in what ships, and elsewhere none apart from those scripts/lib/audit.ts lets through.",
);
