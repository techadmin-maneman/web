// Builds the technician app for one environment into apps/tech/dist/<environment>,
// with its _headers (docs/decisions/0026-hosts-and-surfaces.md), and fails if
// its JavaScript is over the prompt's 150 KB gzipped, as the client app's is.
//
//   npm run build:tech -- --env staging

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { headersFile } from "@maneman/web-kit/headers";
import { TECHNICIAN_APP_POLICY } from "../apps/tech/headers.ts";
import { isEnvironmentName } from "../src/config/environments.ts";

const { values } = parseArgs({ options: { env: { type: "string", default: "local" } } });
const environment = values.env;
if (!isEnvironmentName(environment)) {
  console.error("usage: build-tech --env <local|staging|production>");
  process.exit(2);
}

console.log(`build tech (${environment})`);
execFileSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--config", "apps/tech/vite.config.ts", "--logLevel", "warn"],
  { env: { ...process.env, MM_ENV: environment }, stdio: "inherit" },
);
writeFileSync(`apps/tech/dist/${environment}/_headers`, headersFile(TECHNICIAN_APP_POLICY));

/** "Technician app. First load under 150 KB of gzipped JavaScript" (docs/prompts/phase2-frontend.md). */
const BUDGET_BYTES = 150 * 1024;
const dist = `apps/tech/dist/${environment}`;
const scripts = readdirSync(`${dist}/assets`)
  .filter((file) => file.endsWith(".js"))
  .map((file) => `assets/${file}`);
const gzipped = scripts.reduce((total, file) => total + gzipSync(readFileSync(`${dist}/${file}`)).length, 0);
console.log(
  `tech JavaScript: ${(gzipped / 1024).toFixed(1)} KB gzipped, of a ${String(BUDGET_BYTES / 1024)} KB budget`,
);
if (gzipped > BUDGET_BYTES) {
  console.error("the technician app's JavaScript is over its budget");
  process.exit(1);
}
