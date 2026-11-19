// Fails when a job's Playwright image is not the version the lockfile installs: the image carries the browsers that
// version drives, so a bump of one without the other would fail every browser test on a missing executable.
//
//   node scripts/ci/playwright-image.ts

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { playwrightImageProblems } from "../lib/playwright-image.ts";

const installed = (createRequire(import.meta.url)("@playwright/test/package.json") as { version: string }).version;
const problems = playwrightImageProblems(readFileSync(".github/workflows/ci.yml", "utf8"), installed);
for (const problem of problems) console.error(`::error::${problem}`);
if (problems.length > 0) process.exit(1);
console.log(`Playwright ${installed}: every image matches`);
