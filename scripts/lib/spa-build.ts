// What building a Phase 2 app shares (scripts/build-app.ts, build-ops.ts,
// build-tech.ts): the production gate on its copy, the Vite build for one
// environment into apps/<app>/dist/<environment>, its _headers, and the
// prompt's budget: "first load under 150 KB of gzipped JavaScript"
// (docs/prompts/phase2-frontend.md), a service worker included.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { isEnvironmentName, type EnvironmentName } from "../../src/config/environments.ts";
import { assertPublishableContent, type ContentOwner } from "./content-gate.ts";

export interface SpaBuild {
  /** Its directory, and its name in the content gate: app, ops or tech. */
  readonly app: Exclude<ContentOwner, "site">;
  /** How a sentence names it, e.g. "the client app". */
  readonly label: string;
  /** Its _headers file. */
  readonly headers: string;
}

export interface BuildOptions {
  readonly environment: EnvironmentName;
  /**
   * Builds production with the copy still marked PLACEHOLDER. Only scripts/build.ts
   * passes it, to prove production bundles; a release never does.
   */
  readonly allowPlaceholders: boolean;
}

const BUDGET_BYTES = 150 * 1024;

/** `--env <environment>` and `--allow-placeholders`, as each build script takes them. */
export function buildOptions(script: string): BuildOptions {
  const { values } = parseArgs({
    options: {
      env: { type: "string", default: "local" },
      "allow-placeholders": { type: "boolean", default: false },
    },
  });
  if (!isEnvironmentName(values.env)) {
    console.error(`usage: ${script} --env <local|staging|production> [--allow-placeholders]`);
    process.exit(2);
  }
  return { environment: values.env, allowPlaceholders: values["allow-placeholders"] };
}

/** The commit being built, which the page names so the smoke tests can tell a stale app (scripts/lib/smoke.ts). */
function commitBuilt(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unversioned";
  }
}

function gzippedJavaScript(dist: string): number {
  const scripts = readdirSync(`${dist}/assets`)
    .filter((file) => file.endsWith(".js"))
    .map((file) => `${dist}/assets/${file}`);
  if (existsSync(`${dist}/sw.js`)) scripts.push(`${dist}/sw.js`);
  return scripts.reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0);
}

export function buildSpa(build: SpaBuild, { environment, allowPlaceholders }: BuildOptions): void {
  if (environment === "production" && !allowPlaceholders) {
    try {
      assertPublishableContent(build.app);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  console.log(`build ${build.app} (${environment})`);
  execFileSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--config", `apps/${build.app}/vite.config.ts`, "--logLevel", "warn"],
    { env: { ...process.env, MM_ENV: environment, MM_VERSION: commitBuilt() }, stdio: "inherit" },
  );
  const dist = `apps/${build.app}/dist/${environment}`;
  writeFileSync(`${dist}/_headers`, build.headers);

  const gzipped = gzippedJavaScript(dist);
  const kilobytes = (gzipped / 1024).toFixed(1);
  console.log(`${build.app} JavaScript: ${kilobytes} KB gzipped, of a ${String(BUDGET_BYTES / 1024)} KB budget`);
  if (gzipped > BUDGET_BYTES) {
    console.error(`${build.label}'s JavaScript is over its budget`);
    process.exit(1);
  }
}
