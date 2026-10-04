// How many lines a pull request changes by hand, against the most a reviewer reads well in one sitting. Files a
// command writes are left out, and so are binary files, which `git diff --numstat` counts as "-".
//
// It imports nothing from node_modules: its job installs nothing.

export const LINE_BUDGET = 800;

/** Written by `npm run openapi`, `npm run schema`, `npm run types`, `npm run adr-index` and npm itself; .gitattributes marks the same. */
const GENERATED_FILES = [
  /^docs\/api(-(client|ops|tech))?\.md$/,
  /^docs\/openapi(-(client|ops|tech))?\.json$/,
  /^docs\/schema\.md$/,
  /^docs\/decisions\/README\.md$/,
  /(^|\/)api-schema\.ts$/,
  /^src\/worker-configuration\.d\.ts$/,
  /(^|\/)package-lock\.json$/,
];

export function isGenerated(path: string): boolean {
  return GENERATED_FILES.some((pattern) => pattern.test(path));
}

/** The lines added and deleted in files written by hand, from `git diff --numstat` ("added<TAB>deleted<TAB>path"). */
export function handWrittenLines(numstat: string): number {
  let total = 0;
  for (const line of numstat.split("\n")) {
    const [added, deleted, path] = line.split("\t");
    if (path === undefined || isGenerated(path)) continue;
    total += countOf(added) + countOf(deleted);
  }
  return total;
}

function countOf(field: string | undefined): number {
  const count = Number(field);
  return Number.isInteger(count) ? count : 0;
}
