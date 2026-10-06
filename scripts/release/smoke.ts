// npm run smoke -- --base https://staging.maneman.in --environment staging
// npm run smoke -- --api-base http://localhost:8787 --site-base http://localhost:8788 --environment local
// npm run smoke -- --environment staging --surfaces    every switched-on app host (docs/decisions/0026):
//                                                      mm-api there, and the app the host serves at /
// npm run smoke -- --base https://staging.maneman.in --environment staging --link-preview <code>
//                                                      only the invite <code> as WhatsApp's crawler fetches it,
//                                                      without the Access token: its landing, then its card. No
//                                                      deploy runs it (docs/runbook.md, step 10b)
//
// Options:
//   --version-id <id>         require /api/health to report this Worker version
//   --version-tag <sha>       require /api/health, and each surface's app, to report this commit
//   --override <worker>=<id>  pin requests to a version (Cloudflare-Workers-Version-Overrides)
// Environment:
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET   Access service token (staging); never sent by --link-preview

import { parseArgs } from "node:util";
import { ENABLED_SURFACES, isEnvironmentName, SURFACE_HOSTS } from "../../src/config/environments.ts";
import { runSmoke, type SmokeResult } from "../lib/smoke.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    "api-base": { type: "string" },
    "site-base": { type: "string" },
    environment: { type: "string" },
    "version-id": { type: "string" },
    "version-tag": { type: "string" },
    override: { type: "string", multiple: true },
    surfaces: { type: "boolean", default: false },
    "link-preview": { type: "string" },
  },
});

const environment = values.environment;
const apiBase = values["api-base"] ?? values.base;
const siteBase = values["site-base"] ?? values.base;
const linkPreview = values["link-preview"];
const surfacesOnly = values.surfaces && (environment === "staging" || environment === "production");
if (
  !isEnvironmentName(environment) ||
  (!surfacesOnly && (apiBase === undefined || siteBase === undefined)) ||
  (surfacesOnly && linkPreview !== undefined)
) {
  console.error(
    "usage: smoke --environment <local|staging|production> (--base <url> | --api-base <url> --site-base <url>)\n" +
      "       smoke --environment <staging|production> --surfaces\n" +
      "       smoke --environment <local|staging|production> --base <url> --link-preview <code>",
  );
  process.exit(2);
}

const headers: Record<string, string> = {};

const accessId = process.env.CF_ACCESS_CLIENT_ID ?? "";
const accessSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
if (accessId !== "" && accessSecret !== "") {
  headers["CF-Access-Client-Id"] = accessId;
  headers["CF-Access-Client-Secret"] = accessSecret;
}

// --override mm-api-production=<id> becomes: Cloudflare-Workers-Version-Overrides: mm-api-production="<id>"
const overrides = (values.override ?? []).map((pair) => {
  const [worker, versionId] = pair.split("=");
  if (worker === undefined || versionId === undefined) {
    throw new Error(`--override expects <worker>=<version-id>, got ${pair}`);
  }
  return `${worker}="${versionId}"`;
});
if (overrides.length > 0) headers["Cloudflare-Workers-Version-Overrides"] = overrides.join(", ");

const common = { environment, headers, versionId: values["version-id"], versionTag: values["version-tag"] };
const runs: { base: string; results: SmokeResult[] }[] = [];

if (surfacesOnly) {
  const surfaces = ENABLED_SURFACES[environment].filter((surface) => surface !== "public");
  if (surfaces.length === 0) console.log(`no app surface is switched on in ${environment}`);
  for (const surface of surfaces) {
    const base = `https://${SURFACE_HOSTS[environment][surface]}`;
    runs.push({ base, results: await runSmoke({ ...common, apiBase: base, siteBase: base, surface }) });
  }
} else if (apiBase !== undefined && siteBase !== undefined) {
  const results = await runSmoke({
    ...common,
    apiBase: apiBase.replace(/\/$/, ""),
    siteBase: siteBase.replace(/\/$/, ""),
    linkPreview,
  });
  runs.push({ base: apiBase, results });
}

let failed = 0;
for (const { base, results } of runs) {
  for (const result of results)
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${base}  ${result.name}: ${result.detail}`);
  failed += results.filter((result) => !result.ok).length;
}
if (failed > 0) {
  console.error(`smoke failed: ${String(failed)} check(s)`);
  process.exit(1);
}
for (const { base } of runs) console.log(`smoke passed against ${base} (${environment})`);
