// docs/start-here.md maps each feature to its files. Every file in src/domain/ is on the map, and everything the map
// names exists, so a newcomer can trust it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const MAP = "docs/start-here.md";

interface Entry {
  readonly label: string;
  readonly path: string;
}

/** Each line "- **Label** (`folder/`): `name`, `name`" or "- **Label:** `path`, `path`" of the map, as full paths. */
function entries(markdown: string): Entry[] {
  const map = markdown.slice(markdown.indexOf("## Where each feature lives"), markdown.indexOf("## Your first change"));
  return map.split(/\n(?=- \*\*)/).flatMap((bullet) => {
    const line = /^- \*\*([^*]+?):?\*\*(?: \(`([^`]+)`\))?:?(.*)$/s.exec(bullet);
    if (line === null) return [];
    const [, label = "", folder = "", names = ""] = line;
    return [...names.matchAll(/`([^`]+)`/g)].map((name) => ({ label, path: folder + (name[1] ?? "") }));
  });
}

const pattern = (path: string): RegExp =>
  new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}(\\.tsx?)?$`);

/** Whether the path is a file or folder, with or without its .ts or .tsx, or a * pattern matching one. */
function exists(path: string): boolean {
  if (!path.includes("*")) return [path, `${path}.ts`, `${path}.tsx`].some((candidate) => existsSync(candidate));
  const folder = dirname(path);
  return (
    existsSync(folder) &&
    readdirSync(folder).some((name) => pattern(path).test(join(folder, name).replaceAll("\\", "/")))
  );
}

describe("the start-here map", () => {
  const map = entries(readFileSync(MAP, "utf8"));

  it("reads a line's folder and its names", () => {
    expect(
      entries(
        "## Where each feature lives\n\n- **Rules** (`src/policy/`): `a`, `b-*`\n- **Tests:** `e2e/x.ts`\n\n## Your first change",
      ),
    ).toEqual([
      { label: "Rules", path: "src/policy/a" },
      { label: "Rules", path: "src/policy/b-*" },
      { label: "Tests", path: "e2e/x.ts" },
    ]);
  });

  it("names only what exists", () => {
    expect(map.filter((entry) => !exists(entry.path)).map((entry) => entry.path)).toEqual([]);
  });

  it("puts every file of src/domain/ under a feature", () => {
    const named = map.filter((entry) => entry.label === "Database work").map((entry) => pattern(entry.path));
    const files = readdirSync("src/domain", { recursive: true, encoding: "utf8" })
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => name.endsWith(".ts"));
    expect(files.filter((name) => !named.some((path) => path.test(`src/domain/${name}`)))).toEqual([]);
  });
});
