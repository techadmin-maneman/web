// Which folders of src/domain/ import which (docs/architecture.md): a folder is a module, and an import from one to
// another is a dependency someone has to keep in mind when either changes. Those there are today are listed in
// ./domain-folders-baseline.ts; a new one fails here, and one gone must come off the list, so it only shrinks. A pair
// that import each other is a knot to untie, never one to add.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";
import { describe, expect, it } from "vitest";
import { FOLDER_EDGES } from "./domain-folders-baseline.ts";

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const IMPORT = /^(?:import|export)\s+(?:type\s+)?[^;]*?from\s+"(\.[^"]+)";/gms;
const folderOf = (file: string): string => file.split("/")[2] ?? "";

const EDGES = [
  ...new Set(
    filesUnder("src/domain").flatMap((from) =>
      [...readFileSync(from, "utf8").matchAll(IMPORT)]
        .map((match) => normalize(join(dirname(from), match[1] ?? "")))
        .filter((to) => to.startsWith("src/domain/") && folderOf(to) !== folderOf(from))
        .map((to) => `${folderOf(from)} -> ${folderOf(to)}`),
    ),
  ),
].sort((a, b) => a.localeCompare(b));

describe("the folders of src/domain/", () => {
  it("import only the folders the baseline lists", () => {
    expect(EDGES.filter((edge) => !FOLDER_EDGES.includes(edge))).toEqual([]);
  });

  it("list no import that has since gone, so the baseline only shrinks", () => {
    expect(FOLDER_EDGES.filter((edge) => !EDGES.includes(edge))).toEqual([]);
  });

  it("hold every file in a folder, none at the top", () => {
    expect(readdirSync("src/domain", { withFileTypes: true }).filter((entry) => entry.isFile())).toEqual([]);
  });
});
