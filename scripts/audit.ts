// npm run audit
//
// CI's dependency audit: fails on any high or critical advisory except those scripts/lib/audit.ts lets through.

import { spawnSync } from "node:child_process";
import { failingAdvisories, type AuditReport } from "./lib/audit.ts";

// npm audit exits 1 whenever it finds anything, so its exit code says nothing here; its JSON does.
// One command string: npm is npm.cmd on Windows, which Node starts only through a shell.
const run = spawnSync("npm audit --json", { encoding: "utf8", shell: true });
if (run.stdout.trim() === "") {
  console.error(run.stderr);
  process.exit(1);
}

const failing = failingAdvisories(JSON.parse(run.stdout) as AuditReport, new Date().toISOString().slice(0, 10));
if (failing.length > 0) {
  console.error(`High or critical advisories:\n${failing.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("No high or critical advisory, apart from those scripts/lib/audit.ts lets through.");
