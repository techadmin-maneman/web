// Builds the site for local and staging and the client app for every
// environment, then bundles every Worker in the
// registry (scripts/lib/workers.ts) for every environment without deploying
// (wrangler deploy --dry-run), so a config or bundling error fails the pull
// request rather than the deploy. Production's site is still its placeholder
// (site/wrangler.jsonc), so it is not built here.
//   npm run build

import { execFileSync } from "node:child_process";
import { WORKERS } from "./lib/workers.ts";
// "" is wrangler's name for the top level (local); always name the target.
const ENVIRONMENTS = ["", "staging", "production"] as const;

for (const environment of ["local", "staging"]) {
  execFileSync(process.execPath, ["scripts/build-site.ts", "--env", environment], { stdio: "inherit" });
}
// The client app is built for all three: mm-app is deployed to production without a route (docs/decisions/0043).
for (const environment of ["local", "staging", "production"]) {
  execFileSync(process.execPath, ["scripts/build-app.ts", "--env", environment], { stdio: "inherit" });
}

for (const worker of WORKERS) {
  for (const environment of ENVIRONMENTS) {
    const label = environment === "" ? "local" : environment;
    const args = [
      "node_modules/wrangler/bin/wrangler.js",
      "deploy",
      "--dry-run",
      "--config",
      worker.config,
      "--outdir",
      `dist/${worker.name}/${label}`,
      `--env=${environment}`,
    ];
    console.log(`build ${worker.name} (${label})`);
    execFileSync(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"] });
  }
}
console.log(`build passed: ${String(WORKERS.length)} Workers x ${String(ENVIRONMENTS.length)} environments`);
