// Every browser test recorded, for an audit: each workflow's video filed under videos/ by who uses it, the client, the
// technician or a member of staff by role, with videos/index.md listing them (e2e/video-reporter.ts). Build each
// surface first, as npm run test:e2e needs.
//
//   npm run e2e:videos                         every surface
//   npm run e2e:videos -- --project=ops        the console alone; any other Playwright argument passes through

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const PROJECTS = ["390", "1440", "app", "ops", "tech", "tech-live", "tech-ios"];

const passed = process.argv.slice(2);
const projects = passed.some((arg) => arg.startsWith("--project")) ? [] : PROJECTS.map((name) => `--project=${name}`);

// A run's videos replace the last run's, so the index lists only what this run recorded.
rmSync("videos", { recursive: true, force: true });
const run = spawnSync(
  process.execPath,
  // One try each: a retry would file a second video of the same workflow.
  ["node_modules/@playwright/test/cli.js", "test", ...projects, "--retries=0", ...passed],
  { stdio: "inherit", env: { ...process.env, E2E_VIDEO: "on" } },
);
process.exit(run.status ?? 1);
