// npm run smoke -- --base https://staging.maneman.in --environment staging
// npm run smoke -- --api-base http://localhost:8787 --site-base http://localhost:8788 --environment local
//
// Options:
//   --version-id <id>         require /api/health to report this Worker version
//   --version-tag <sha>       require /api/health to report this upload tag
//   --override <worker>=<id>  pin requests to a version (Cloudflare-Workers-Version-Overrides)
// Environment:
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET   Access service token (staging)

import { parseArgs } from "node:util";
import { isEnvironmentName } from "../src/config/environments.ts";
import { runSmoke } from "./lib/smoke.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    "api-base": { type: "string" },
    "site-base": { type: "string" },
    environment: { type: "string" },
    "version-id": { type: "string" },
    "version-tag": { type: "string" },
    override: { type: "string", multiple: true },
  },
});

const environment = values.environment;
const apiBase = values["api-base"] ?? values.base;
const siteBase = values["site-base"] ?? values.base;
if (!isEnvironmentName(environment) || apiBase === undefined || siteBase === undefined) {
  console.error(
    "usage: smoke --environment <local|staging|production> (--base <url> | --api-base <url> --site-base <url>)",
  );
  process.exit(2);
}

const headers: Record<string, string> = {};
const accessId = process.env.CF_ACCESS_CLIENT_ID;
const accessSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (accessId !== undefined && accessId !== "" && accessSecret !== undefined && accessSecret !== "") {
  headers["CF-Access-Client-Id"] = accessId;
  headers["CF-Access-Client-Secret"] = accessSecret;
}
const overrides = (values.override ?? []).map((pair) => {
  const [worker, id] = pair.split("=");
  if (worker === undefined || id === undefined)
    throw new Error(`--override expects <worker>=<version-id>, got ${pair}`);
  return `${worker}="${id}"`;
});
if (overrides.length > 0) headers["Cloudflare-Workers-Version-Overrides"] = overrides.join(", ");

const results = await runSmoke({
  apiBase: apiBase.replace(/\/$/, ""),
  siteBase: siteBase.replace(/\/$/, ""),
  environment,
  headers,
  ...(values["version-id"] === undefined ? {} : { versionId: values["version-id"] }),
  ...(values["version-tag"] === undefined ? {} : { versionTag: values["version-tag"] }),
});

for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}: ${result.detail}`);
const failed = results.filter((result) => !result.ok).length;
if (failed > 0) {
  console.error(`smoke failed: ${String(failed)} of ${String(results.length)} check(s)`);
  process.exit(1);
}
console.log(`smoke passed against ${apiBase} (${environment})`);
