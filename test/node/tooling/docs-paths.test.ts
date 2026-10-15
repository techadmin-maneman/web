// Every repository path the docs and the code's comments name, as `src/…` or `docs/…`, is there: a path left behind
// by a move sends the next engineer to nothing. A path may be the start of one, as an ADR named by its number or a
// family of files, and one an app's own doc or comment names from the app's root. The record of what was decided and
// said, the ADRs, the archive and the prompts, keeps the paths of its day.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "scripts", "test", "e2e", "apps", "packages", "site", "docs", "migrations", ".github", "data"];
/** A word that begins at a root and runs to the next space, quote, bracket or comma. */
const PATH = new RegExp(String.raw`(?<![\w./@-])((?:${ROOTS.join("|").replace(".", "\\.")})\/[^\s\`'"(),;:\]]*)`, "g");
/** A pattern or a placeholder rather than a path. */
const NOT_A_PATH = /[*<>{}[\]]|\.\.\.|…|NNNN/;

const tracked = (...paths: string[]) =>
  execFileSync("git", ["ls-files", ...paths], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const EVERY_FILE = tracked();
/** Where a path may be named from: the repository, or an app's, a package's or the site's own root. */
const PACKAGE_ROOTS = [
  "",
  "site/",
  ...new Set(EVERY_FILE.flatMap((file) => /^(apps|packages)\/[^/]+\//.exec(file)?.[0] ?? [])),
];

/** Whether git ignores the path: a build's output, as `site/dist/production`, which no checkout holds until built. */
function ignored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", path]);
    return true;
  } catch {
    return false;
  }
}

const isThere = (path: string): boolean =>
  PACKAGE_ROOTS.some((root) => EVERY_FILE.some((file) => file.startsWith(`${root}${path}`))) || ignored(path);

const DOCS = tracked("docs", "README.md", "CONTRIBUTING.md").filter(
  (file) =>
    file.endsWith(".md") &&
    !/^docs\/(archive|prompts|decisions|fidelity)\//.test(file) &&
    // Each is a dated record of what was proven or planned, kept as it was.
    !["docs/verification.md", "docs/codebase-upgrade-plan.md", "docs/open-points-settled.md"].includes(file),
);

const CODE = tracked("src", "scripts", "test", "e2e", "apps", "packages", "site/src").filter(
  (file) => /\.(ts|tsx|astro|mjs)$/.test(file) && !/(api-schema|worker-configuration\.d)\.ts$/.test(file),
);
const COMMENT = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

/** The paths a text names that are not there, each as "line: path". */
function missingIn(text: string, onlyComments: boolean, there: (path: string) => boolean = isThere): string[] {
  return text.split("\n").flatMap((line, index) => {
    if (onlyComments && !COMMENT.test(line)) return [];
    return [...line.matchAll(PATH)]
      .map((match) => (match[1] ?? "").replace(/[.!?]+$/, ""))
      .filter((path) => !NOT_A_PATH.test(path) && !there(path))
      .map((path) => `${String(index + 1)}: ${path}`);
  });
}

describe("the paths the docs and comments name", () => {
  it("know a path that is not there, and leave patterns, placeholders and the starts of paths alone", () => {
    const there = (path: string) =>
      ["src/config/limits.ts", "docs/decisions/0111-a.md"].some((f) => f.startsWith(path));
    const text = "See `src/nowhere.ts`, `src/config/`, `src/**/*.ts`, src/x/<name>.ts and docs/decisions/0111.";
    expect(missingIn(text, false, there)).toEqual(["1: src/nowhere.ts"]);
  });

  it("are each there, in the docs", () => {
    const missing = DOCS.flatMap((file) => missingIn(readFileSync(file, "utf8"), false).map((hit) => `${file}:${hit}`));
    expect(missing).toEqual([]);
  });

  it("are each there, in the code's comments", () => {
    const missing = CODE.flatMap((file) => missingIn(readFileSync(file, "utf8"), true).map((hit) => `${file}:${hit}`));
    expect(missing).toEqual([]);
  });
});
