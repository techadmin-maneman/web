// npm run audit
//
// CI's dependency audit: fails on any high or critical advisory except those scripts/lib/audit.ts lets through, and on
// any high or critical in the production dependencies with none let through. An allowance is for a tool that runs only
// in development or CI; the production dependencies are what the Workers and the apps ship, and the preact the site's
// islands ship. Astro's island loader and @astrojs/preact's client ship to the site from development dependencies, so
// an allowance touching either is judged by hand. An answer from npm that is no report, as when the registry cannot be
// reached, fails.

import { spawnSync } from "node:child_process";
import { ALLOWED, failingAdvisories, noAudit, type Allowance, type AuditReport } from "../lib/audit.ts";

const today = new Date().toISOString().slice(0, 10);

/** What fails in one audit, under the allowances given; the run stops where npm gave no report. */
function failing(command: string, allowed: readonly Allowance[]): string[] {
  // npm audit exits 1 whenever it finds anything, so its exit code says nothing here; its JSON does.
  // One command string: npm is npm.cmd on Windows, which Node starts only through a shell.
  const run = spawnSync(command, { encoding: "utf8", shell: true });
  if (run.stdout.trim() === "") {
    console.error(run.stderr);
    process.exit(1);
  }
  const report = JSON.parse(run.stdout) as AuditReport;
  const problem = noAudit(report);
  if (problem !== null) {
    console.error(`${command} gave no audit: ${problem}`);
    process.exit(1);
  }
  return failingAdvisories(report, today, allowed);
}

const everything = failing("npm audit --json", ALLOWED);
const production = failing("npm audit --omit=dev --json", []);
if (everything.length > 0 || production.length > 0) {
  const lines = (list: string[]) => list.map((line) => `  ${line}`).join("\n");
  if (everything.length > 0) console.error(`High or critical advisories:\n${lines(everything)}`);
  if (production.length > 0) {
    console.error(
      `High or critical advisories in the production dependencies, none let through:\n${lines(production)}`,
    );
  }
  process.exit(1);
}
console.log(
  "No high or critical advisory: none in the production dependencies, and elsewhere none apart from those " +
    "scripts/lib/audit.ts lets through.",
);
