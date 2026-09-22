// Builds the client app for one environment into apps/app/dist/<environment>,
// with its _headers (docs/decisions/0043-client-app.md).
//
//   npm run build:app -- --env staging

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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
