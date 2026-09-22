// Builds the client app for one environment into apps/app/dist/<environment>,
// with its _headers (docs/decisions/0043-client-app.md), and fails if its
// JavaScript is over the prompt's 150 KB gzipped.
//
//   npm run build:app -- --env staging

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { headersFile } from "@maneman/web-kit/headers";
import { CLIENT_APP_POLICY } from "../apps/app/headers.ts";
import { isEnvironmentName } from "../src/config/environments.ts";

const { values } = parseArgs({ options: { env: { type: "string", default: "local" } } });
const environment = values.env;
if (!isEnvironmentName(environment)) {
  console.error("usage: build-app --env <local|staging|production>");
  process.exit(2);
}

console.log(`build app (${environment})`);
execFileSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--config", "apps/app/vite.config.ts", "--logLevel", "warn"],
  { env: { ...process.env, MM_ENV: environment }, stdio: "inherit" },
);
writeFileSync(`apps/app/dist/${environment}/_headers`, headersFile(CLIENT_APP_POLICY));

/** "Client app: first load under 150 KB of gzipped JavaScript" (docs/prompts/phase2-frontend.md), the service worker included. */
const BUDGET_BYTES = 150 * 1024;
const dist = `apps/app/dist/${environment}`;
const scripts = [
  "sw.js",
  ...readdirSync(`${dist}/assets`)
    .filter((file) => file.endsWith(".js"))
    .map((file) => `assets/${file}`),
];
const gzipped = scripts.reduce((total, file) => total + gzipSync(readFileSync(`${dist}/${file}`)).length, 0);
console.log(`app JavaScript: ${(gzipped / 1024).toFixed(1)} KB gzipped, of a ${String(BUDGET_BYTES / 1024)} KB budget`);
if (gzipped > BUDGET_BYTES) {
  console.error("the client app's JavaScript is over its budget");
  process.exit(1);
}
