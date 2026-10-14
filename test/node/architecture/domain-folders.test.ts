// Which folders of src/domain/ import which (docs/architecture.md): a folder is a module, and an import from one to
// another is a dependency someone has to keep in mind when either changes. Every such import is listed in
// ./domain-folders-baseline.ts, one gone must come off the list, and a new one goes on it on purpose. Two folders that
// import each other are a knot: those there are today are listed, the list only shrinks, and a new one fails here.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";
import { describe, expect, it } from "vitest";
import { FOLDER_EDGES, KNOTS } from "./domain-folders-baseline.ts";

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

/** Each pair of folders that import each other, as "a <-> b" with a before b. */
const knotted = EDGES.flatMap((edge) => {
  const [from = "", to = ""] = edge.split(" -> ");
  return from < to && EDGES.includes(`${to} -> ${from}`) ? [`${from} <-> ${to}`] : [];
});

describe("the folders of src/domain/", () => {
  it("import only the folders the baseline lists", () => {
    expect(EDGES.filter((edge) => !FOLDER_EDGES.includes(edge))).toEqual([]);
  });

  it("list no import that has since gone", () => {
    expect(FOLDER_EDGES.filter((edge) => !EDGES.includes(edge))).toEqual([]);
  });

  it("tie no new knot: two folders that import each other only where the list of knots has them", () => {
    expect(knotted.filter((knot) => !KNOTS.includes(knot))).toEqual([]);
  });

  it("list no knot since untied, so the list of knots only shrinks", () => {
    expect(KNOTS.filter((knot) => !knotted.includes(knot))).toEqual([]);
  });

  it("hold every file in a folder, none at the top", () => {
    expect(readdirSync("src/domain", { withFileTypes: true }).filter((entry) => entry.isFile())).toEqual([]);
  });
});
