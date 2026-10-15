// The lint, in four runs (`npm run lint`). ESLint checks each file through its TypeScript project, and a run over the
// whole repository holds all eleven projects at once, past 4 GB, all of CI's heap. Each run here holds
// its own part's projects only, the largest about 2.3 GB. Together they lint every file `eslint .` would.
//
//   node scripts/ci/lint.ts [--fix]
//
// Every run goes ahead whatever the one before found, so one pass reports every part; arguments go to each run.

import { spawnSync } from "node:child_process";
import { FRONT_PINNED } from "../../eslint.front-pinned.ts";

const WORKER = ["src", "test/worker"];
const FRONT_ENDS = ["apps", "packages/ui", "e2e", "test/dom"];
const SITE = ["site"];
const ELSEWHERE = [...WORKER, ...FRONT_ENDS, ...SITE].flatMap((dir) => ["--ignore-pattern", `${dir}/**`]);

const RUNS: readonly (readonly string[])[] = [WORKER, FRONT_ENDS, SITE, [".", ...ELSEWHERE]];

const given = process.argv.slice(2);
const failed = RUNS.filter((paths) => {
  const run = spawnSync(process.execPath, ["node_modules/eslint/bin/eslint.js", ...paths, ...given], {
    stdio: "inherit",
  });
  return run.status !== 0;
});
// The files held past the size rules, which only fall (test/node/tooling/front-pinned.test.ts).
console.log(`${String(Object.keys(FRONT_PINNED).length)} front-end files are held past the size rules`);
process.exitCode = failed.length === 0 ? 0 : 1;
