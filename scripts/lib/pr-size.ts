// How big a pull request is, counted as a reviewer reads it: lines changed in files a person wrote. The files
// `npm run gen` writes, the lockfile and the fidelity pictures are left out, and .gitattributes marks the same ones
// as generated, so GitHub folds them away too (test/node/pr-size.test.ts holds the two together).

/** What a person did not write: each is a path, or a folder ending in "/", or a file name under any folder. */
export const GENERATED = [
  "package-lock.json",
  "src/worker-configuration.d.ts",
  "docs/openapi.json",
  "docs/openapi-client.json",
  "docs/openapi-ops.json",
  "docs/openapi-tech.json",
  "docs/api.md",
  "docs/api-client.md",
  "docs/api-ops.md",
  "docs/api-tech.md",
  "docs/schema.md",
  "docs/decisions/README.md",
  "docs/fidelity/",
  "site/src/lib/api-schema.ts",
  "apps/app/src/api-schema.ts",
  "apps/ops/src/api-schema.ts",
  "apps/tech/src/api-schema.ts",
] as const;

/** Past this, a pull request is hard to review in one sitting: CI says so, and asks for it split. */
export const REVIEWABLE_LINES = 800;

export const isGenerated = (path: string): boolean =>
  GENERATED.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

/** The lines added and removed in files a person wrote, from `git diff --numstat` (a binary file counts as none). */
export function writtenLines(numstat: string): number {
  return numstat
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([added, , path]) => added !== undefined && path !== undefined && !isGenerated(path))
    .reduce((total, [added = "-", removed = "-"]) => total + (Number(added) || 0) + (Number(removed) || 0), 0);
}
