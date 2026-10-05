// Builds the site for local and staging and each Phase 2 app for every
// environment, then bundles every Worker in the
// registry (scripts/lib/workers.ts) for every environment without deploying
// (wrangler deploy --dry-run), so a config or bundling error fails the pull
// request rather than the deploy. Production's site is still its placeholder
// (site/wrangler.jsonc), so it is not built here.
//   npm run build

import { execFileSync } from "node:child_process";
import { WORKERS } from "../lib/workers.ts";
// "" is wrangler's name for the top level (local); always name the target.
const ENVIRONMENTS = ["", "staging", "production"] as const;

for (const environment of ["local", "staging"]) {
  execFileSync(process.execPath, ["scripts/build/build-site.ts", "--env", environment], { stdio: "inherit" });
}
// The apps are built for all three: each is deployed to production without a route until its surface is
// switched on there (docs/decisions/0026-hosts-and-surfaces.md). This proves production bundles, and ships
// nothing, so it lets through the copy a release's production build refuses (scripts/lib/content-gate.ts).
for (const environment of ["local", "staging", "production"]) {
  const gate = environment === "production" ? ["--allow-placeholders"] : [];
  for (const app of ["app", "ops", "tech"]) {
    execFileSync(process.execPath, [`scripts/build/build-${app}.ts`, "--env", environment, ...gate], {
      stdio: "inherit",
    });
  }
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
