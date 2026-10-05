// mm-api alone, as `npm run dev:all` starts it (docs/getting-started.md):
//
//   npm run dev
//
// The local login code (every code is 246810), the limits raised, the dev routes on and the cron run by hand
// (npm run tick), on :8787, so a change to the API can be tried with curl, or with an app's own Vite server
// beside it. Ctrl+C stops it.

import { spawnSync } from "node:child_process";
import { apiDevArgs, LOCAL_LOGIN_CODE, PORTS } from "../lib/local-stack.ts";

/** Runs a step to its end, and stops here if it fails. */
function run(args: readonly string[]): void {
  const step = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (step.status !== 0) process.exit(step.status ?? 1);
}

run(["scripts/dev/ensure-dev-vars.ts"]);
run(["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local"]);
run(["scripts/release/mark-database.ts", "local"]);

console.log(`\nmm-api on http://localhost:${String(PORTS.api)}; every login code is ${LOCAL_LOGIN_CODE}\n`);
run(apiDevArgs({ DEV_ROUTES: "on" }, ["--test-scheduled"]));
