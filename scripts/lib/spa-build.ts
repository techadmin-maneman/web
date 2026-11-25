// What building an app shares (scripts/build/build-app.ts, build-ops.ts,
// build-tech.ts): the production gate on its copy, the Vite build for one
// environment into apps/<app>/dist/<environment>, its _headers, and the
// prompt's budget: "first load under 150 KB of gzipped JavaScript"
// (docs/prompts/phase2-frontend.md), what the first screen loads. The phone apps'
// is 200 KB, for their redesigns: the technician app's
// (docs/decisions/0247-the-steps-left.md) and the client's
// (docs/decisions/0252-client-app-redesign.md); the console's is 175 KB
// (docs/decisions/0295-the-consoles-first-load.md); what the phone apps' service
// workers keep has a ceiling of its own (docs/decisions/0284-the-first-screen-and-the-precache.md).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
  /**
   * The chunk of the section a first visit opens on, by its name ("TodayScreen" for TodayScreen-abc.js), where the page
   * loads it as it opens: counted in the first load with every module it imports.
   */
  readonly landing?: string;
  /**
   * Whether its service worker keeps the build; the console's only shows a push
   * (docs/decisions/0323-the-unanswered-lead-alert.md), so it has no precache to hold to a budget.
   */
  readonly precache?: false;
}

export interface BuildOptions {
  readonly environment: EnvironmentName;
  /**
   * Builds production with the copy still marked PLACEHOLDER. Only scripts/build/build.ts
   * passes it, to prove production bundles; a release never does.
   */
  readonly allowPlaceholders: boolean;
}

/** Each app's first load, in gzipped bytes: the phone apps', the client's and the technician's, and the console's. */
const PHONE_BUDGET_BYTES = 200 * 1024;
const BUDGET_BYTES = 175 * 1024;

/** Everything a phone app's service worker keeps, in gzipped bytes, which a first visit fetches after the first screen. */
const PRECACHE_BUDGET_BYTES = 260 * 1024;

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

/**
 * The pages a local build adds for the people building the app, which no other build carries and no phone is served:
 * the technician app's parts page (apps/tech/src/main.tsx). The budget counts what ships, so they are left out of it.
 */
const LOCAL_ONLY = "PartsScreen-";

function everyScript(dist: string): string[] {
  // Only a local build's: any other carrying the page would count it, so nothing that ships is ever left out.
  const local = /[\\/]local$/.test(dist);
  return readdirSync(`${dist}/assets`)
    .filter((file) => file.endsWith(".js") && !(local && file.startsWith(LOCAL_ONLY)))
    .map((file) => `${dist}/assets/${file}`);
}

/** The scripts the page itself loads, and the modules it preloads with them, as "/assets/index-abc.js". */
function pageScripts(dist: string): string[] {
  const page = readFileSync(`${dist}/index.html`, "utf8");
  const tags = page.match(/<(?:script|link)\b[^>]*>/g) ?? [];
  const loading = tags.filter((tag) => tag.startsWith("<script") || tag.includes('rel="modulepreload"'));
  const files: string[] = [];
  for (const tag of loading) {
    const path = /\s(?:src|href)="\/([^"]+\.js)"/.exec(tag)?.[1];
    if (path !== undefined) files.push(`${dist}/${path}`);
  }
  if (files.length === 0) throw new Error(`${dist}/index.html loads no script`);
  return files;
}

/** The scripts a built one imports as it loads, `import{a}from"./x-1.js"`: never one it loads later, `import("…")`. */
function staticImports(file: string): string[] {
  const named = readFileSync(file, "utf8").matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g);
  return [...named].map((match) => `${dirname(file)}/${match[1] ?? ""}`);
}

/** The scripts given, and every script each imports as it loads, followed through. */
function withImports(starts: readonly string[]): string[] {
  const seen = new Set<string>();
  const waiting = [...starts];
  for (let file = waiting.pop(); file !== undefined; file = waiting.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    waiting.push(...staticImports(file));
  }
  return [...seen];
}

/** The landing section's one chunk; any other count, and the build cannot say what a first visit loads. */
function landingChunk(dist: string, landing: string): string {
  const found = readdirSync(`${dist}/assets`).filter((file) => file.startsWith(`${landing}-`) && file.endsWith(".js"));
  if (found.length !== 1) throw new Error(`${dist} has ${String(found.length)} chunks named ${landing}, not one`);
  return `${dist}/assets/${found[0] ?? ""}`;
}

/**
 * The JavaScript a first visit fetches before its first screen draws:
 * what the page loads and the section it opens on, each with what it imports. Another section is fetched when it opens,
 * or, with a service worker, after the first screen, as the worker keeps it (precachedScripts).
 */
export function firstLoadScripts(dist: string, landing?: string): string[] {
  const page = pageScripts(dist);
  return withImports(landing === undefined ? page : [...page, landingChunk(dist, landing)]);
}

/** Every script a service worker keeps, and the worker: none where the app has no worker. */
export function precachedScripts(dist: string): string[] {
  return existsSync(`${dist}/sw.js`) ? [...everyScript(dist), `${dist}/sw.js`] : [];
}

const gzipped = (files: readonly string[]): number =>
  files.reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0);

/** Says what a build's JavaScript comes to against its budget, and stops the build where it is over. */
function heldTo(label: string, what: string, bytes: number, budget: number): void {
  console.log(`${what}: ${(bytes / 1024).toFixed(1)} KB gzipped, of a ${String(budget / 1024)} KB budget`);
  if (bytes > budget) {
    console.error(`${label}'s ${what} is over its budget`);
    process.exit(1);
  }
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

  const budget = build.app === "tech" || build.app === "app" ? PHONE_BUDGET_BYTES : BUDGET_BYTES;
  heldTo(build.label, `${build.app} JavaScript`, gzipped(firstLoadScripts(dist, build.landing)), budget);
  const kept = build.precache === false ? [] : precachedScripts(dist);
  if (kept.length > 0) heldTo(build.label, `${build.app} precache`, gzipped(kept), PRECACHE_BUDGET_BYTES);
}
