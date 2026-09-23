// Builds the ops console for one environment into apps/ops/dist/<environment>,
// with its _headers (docs/decisions/0026-hosts-and-surfaces.md), and fails if
// its JavaScript is over the prompt's 150 KB gzipped, as the client app's is.
//
//   npm run build:ops -- --env staging

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { headersFile } from "@maneman/web-kit/headers";
import { OPS_CONSOLE_POLICY } from "../apps/ops/headers.ts";
import { isEnvironmentName } from "../src/config/environments.ts";

const { values } = parseArgs({ options: { env: { type: "string", default: "local" } } });
const environment = values.env;
if (!isEnvironmentName(environment)) {
  console.error("usage: build-ops --env <local|staging|production>");
  process.exit(2);
}

console.log(`build ops (${environment})`);
execFileSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--config", "apps/ops/vite.config.ts", "--logLevel", "warn"],
  { env: { ...process.env, MM_ENV: environment }, stdio: "inherit" },
);
writeFileSync(`apps/ops/dist/${environment}/_headers`, headersFile(OPS_CONSOLE_POLICY));

/** The same budget the client app keeps to (docs/prompts/phase2-frontend.md). */
const BUDGET_BYTES = 150 * 1024;
const dist = `apps/ops/dist/${environment}`;
const scripts = readdirSync(`${dist}/assets`)
  .filter((file) => file.endsWith(".js"))
  .map((file) => `assets/${file}`);
const gzipped = scripts.reduce((total, file) => total + gzipSync(readFileSync(`${dist}/${file}`)).length, 0);
console.log(`ops JavaScript: ${(gzipped / 1024).toFixed(1)} KB gzipped, of a ${String(BUDGET_BYTES / 1024)} KB budget`);
if (gzipped > BUDGET_BYTES) {
  console.error("the ops console's JavaScript is over its budget");
  process.exit(1);
}
