// Builds the public site for one environment into site/dist/<environment>.
//
//   npm run build:site -- --env staging
//   npm run dev:site              (the Astro dev server, as local)
//   npm run check:site            (astro check: the templates' types)
//
// Production is refused by the publish gate until the content is ready
// (docs/frontend.md); production keeps serving its placeholder until then. The
// gate runs in site/astro.config.ts, so it holds however the site is built, and
// refuses copy still marked PLACEHOLDER too (scripts/lib/content-gate.ts).

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "local" },
    dev: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
  },
});
const environment = values.env;
const [verb, command] = values.check
  ? ["check", ["check", "--minimumSeverity", "warning"]]
  : values.dev
    ? ["serve", ["dev", "--port", "4321"]]
    : ["build", ["build", "--silent"]];

console.log(`${verb} site (${environment})`);
const astro = spawnSync(process.execPath, ["node_modules/astro/bin/astro.mjs", ...command, "--root", "site"], {
  env: { ...process.env, MM_ENV: environment },
  stdio: "inherit",
});
process.exit(astro.status ?? 1);
