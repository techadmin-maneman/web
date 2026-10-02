// Runs the Worker tests of the code now deployed (the base branch's) against
// this branch's migrations. Migrations run before code and are never rolled
// back (docs/decisions/0006-deployment-pipeline.md), so the deployed code runs
// on the new schema until the deploy, and again after any rollback. The
// migrations check (scripts/check-migrations.ts) only reads the SQL for DROP,
// RENAME and DELETE; this runs the old code, so a new NOT NULL column its
// inserts leave out, or a constraint its writes break, fails here too.
//
//   node scripts/old-code-on-new-schema.ts --base origin/main
//
// Run it on the pull request's merge with its base, as CI does, so the
// migrations are the base's and the branch's together. CI runs it only when a
// migration changed. It imports nothing from node_modules, so its job installs
// only the base's dependencies.

import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const isWindows = process.platform === "win32";

const { values } = parseArgs({ options: { base: { type: "string" } } });
const base = values.base ?? "";
if (base === "") {
  console.error("usage: node scripts/old-code-on-new-schema.ts --base <git-ref>");
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), "deployed-"));
const deployed = join(scratch, "code");
const archive = join(scratch, "code.tar");
execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, base]);
mkdirSync(deployed);
// Relative paths: GNU tar reads "C:" in a Windows path as a remote host.
execFileSync("tar", ["-xf", "code.tar", "-C", "code"], { cwd: scratch });

rmSync(join(deployed, "migrations"), { recursive: true });
cpSync("migrations", join(deployed, "migrations"), { recursive: true });
console.log(`${base}'s code, with this branch's migrations, in ${deployed}`);

// Tests that check the code's own fixtures cover every table. A newer schema rightly fails them (the branch adds the
// fixture row for its new table), so the deployed code skips them here; they still run on the branch's own code.
const FIXTURE_COVERAGE_TESTS = ["starts from a row in every table"];
const skipFixtureCoverage = `^(?!.*(${FIXTURE_COVERAGE_TESTS.join("|")})).*$`;

function mustPass(run: SpawnSyncReturns<Buffer>): void {
  if (run.status !== 0) process.exit(run.status ?? 1);
}

// npm is npm.cmd on Windows, which Node starts only through a shell.
mustPass(spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: deployed, stdio: "inherit", shell: isWindows }));
mustPass(
  spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--project", "worker", "--testNamePattern", skipFixtureCoverage],
    {
      cwd: deployed,
      stdio: "inherit",
    },
  ),
);
console.log(`${base}'s Worker tests pass on this branch's migrations.`);
