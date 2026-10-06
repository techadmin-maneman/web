// Every Worker this repository deploys. The build, the release script and the
// config check read this list, and test/node/tooling/workers-registry.test.ts fails if
// a Worker here is missing from either deploy workflow. A new app's Worker is
// added here.
//
//   api   mm-api: every binding and secret, the /api/* routes
//   site  mm-site: the Astro site, static assets
//   spa   a single-page app: static assets that answer every path with index.html

import type { Surface } from "../../src/config/environments.ts";

export type WorkerKind = "api" | "site" | "spa";

export interface WorkerEntry {
  /** The Worker's name at the top level (local); each environment appends -staging or -production. */
  readonly name: string;
  /** Its wrangler config, from the repository root. */
  readonly config: string;
  readonly kind: WorkerKind;
  /** A single-page app's surface, whose host it serves (docs/decisions/0026-hosts-and-surfaces.md). */
  readonly surface?: Surface;
}

export const WORKERS = [
  { name: "mm-api", config: "wrangler.jsonc", kind: "api" },
  { name: "mm-site", config: "site/wrangler.jsonc", kind: "site" },
  { name: "mm-app", config: "apps/app/wrangler.jsonc", kind: "spa", surface: "client" },
  { name: "mm-ops", config: "apps/ops/wrangler.jsonc", kind: "spa", surface: "ops" },
  { name: "mm-tech", config: "apps/tech/wrangler.jsonc", kind: "spa", surface: "tech" },
] as const satisfies readonly WorkerEntry[];

export type WorkerName = (typeof WORKERS)[number]["name"];

export function isWorkerName(name: string | undefined): name is WorkerName {
  return WORKERS.some((worker) => worker.name === name);
}

export function workerNamed(name: WorkerName): WorkerEntry {
  const worker = WORKERS.find((candidate) => candidate.name === name);
  if (worker === undefined) throw new Error(`no Worker named ${name}`);
  return worker;
}

/** The Workers that serve static assets and hold no bindings. */
export const STATIC_WORKERS: readonly WorkerEntry[] = WORKERS.filter((worker) => worker.kind !== "api");
