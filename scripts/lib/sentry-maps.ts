// What scripts/release/sentry-maps.ts uploads to Sentry, and where each map is matched: mm-api's bundle by its bare
// file name, as the Worker's frames carry it ("app:///index.js", src/providers/error-tracking.ts), and each app's
// build, its service worker too, by each file's path on any host, as a page's frames carry it
// ("https://app.maneman.in/assets/x.js").

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Sentry's organisation, whose project for each environment is mm-api's. */
export const SENTRY_ORG = "mane-man";

export type MapsEnvironment = "staging" | "production";

export interface MapUpload {
  /** The folder whose .js files and maps go up. */
  readonly dir: string;
  /** What Sentry matches the files by, "~" being any scheme and host. */
  readonly urlPrefix: string;
}

/** mm-api's kept bundle, then each app's build, each file by its path from the folder. */
export function uploadsFor(worker: string | undefined, apps: readonly string[]): MapUpload[] {
  return [worker, ...apps].flatMap((dir) => (dir === undefined ? [] : [{ dir, urlPrefix: "~/" }]));
}

/** sentry-cli's arguments for one upload, under the release mm-api reports its errors with. */
export function uploadArgs(upload: MapUpload, environment: MapsEnvironment, release: string): string[] {
  return [
    "sourcemaps",
    "upload",
    "--org",
    SENTRY_ORG,
    "--project",
    `mm-api-${environment}`,
    "--release",
    release,
    "--url-prefix",
    upload.urlPrefix,
    upload.dir,
  ];
}

/** Deletes every source map under `dir`, so none ships with the app; how many there were. */
export function deleteMaps(dir: string): number {
  const maps = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".map"));
  for (const path of maps) rmSync(join(dir, path));
  return maps.length;
}
