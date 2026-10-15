// The files the code names, and the maps of it (docs/architecture.md, docs/start-here.md): each one is there, from the
// repository or from the app or site it is written in. A comment that points at a file since moved sends a new engineer
// nowhere. The decision records, the verification log and the rest of docs/ keep the paths of their day, as history
// does.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SKIPPED = /node_modules|\/dist\/|api-schema\.ts$|worker-configuration\.d\.ts$/;

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (SKIPPED.test(path)) return [];
    if (entry.isDirectory()) return filesUnder(path);
    return /\.(ts|tsx|md|astro|css)$/.test(path) ? [path] : [];
  });
}

const CITED =
  /(?<![\w./-])((?:src|apps|packages|scripts|docs|migrations|site|test|e2e)\/[\w./-]+\.(?:tsx|ts|md|sql|css|jsonc|json|astro))(?!\w)/g;

/** The folder a path in this file may be read from besides the repository's: its app's, or the site's. */
const ownRoot = (file: string): string | null => /^(apps\/[\w-]+|site)\//.exec(file)?.[1] ?? null;

const MAPS = ["docs/architecture.md", "docs/start-here.md"];

/** A file a build writes, which git ignores: there once the build has run, and named before it has. */
function written(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", path]);
    return true;
  } catch {
    return false;
  }
}

const missing = [...["src", "apps", "packages", "scripts", "site/src"].flatMap(filesUnder), ...MAPS].flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(CITED)]
    .map((match) => match[1] ?? "")
    .filter((cited) => !existsSync(cited) && !existsSync(`${ownRoot(file) ?? "."}/${cited}`) && !written(cited))
    .map((cited) => `${file}: ${cited}`),
);

describe("the files the code and the docs name", () => {
  it("are each where they say", () => {
    expect([...new Set(missing)]).toEqual([]);
  });
});
