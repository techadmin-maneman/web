// Builds the public site for one environment into site/dist/<environment>.
//
//   npm run build:site -- --env staging --words   (as a deploy builds: with the words published for staging)
//   npm run dev:site              (the Astro dev server, as local)
//   npm run check:site            (astro check: the templates' types)
//
// Production is refused by the publish gate until the content is ready
// (docs/frontend.md); production keeps serving its placeholder until then. The
// gate runs in site/astro.config.ts, so it holds however the site is built, and
// refuses copy still marked PLACEHOLDER too (scripts/lib/content-gate.ts).

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fetchSiteWords } from "../lib/site-words.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "local" },
    dev: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    words: { type: "boolean", default: false },
  },
});
const environment = values.env;
/** What the run does: check the templates' types, serve the site, or build it. */
function verbOf(): [string, string[]] {
  if (values.check) return ["check", ["check", "--minimumSeverity", "warning"]];
  return values.dev ? ["serve", ["dev", "--port", "4321"]] : ["build", ["build", "--silent"]];
}
const [verb, command] = verbOf();

console.log(`${verb} site (${environment})`);
// With --words, as a deploy builds, the words published for this environment, which the build lays over the copy
// (site/src/lib/published-words.ts); without, none, so a test's build reads nothing over the network.
if (verb === "build") {
  const words = values.words ? await fetchSiteWords(environment, process.env, fetch) : {};
  writeFileSync("site/.words.json", JSON.stringify(words));
}
const astro = spawnSync(process.execPath, ["node_modules/astro/bin/astro.mjs", ...command, "--root", "site"], {
  env: { ...process.env, MM_ENV: environment },
  stdio: "inherit",
});
process.exit(astro.status ?? 1);
