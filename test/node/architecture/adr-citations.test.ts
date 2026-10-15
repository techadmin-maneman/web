// A file points to a decision record once, where the decision behind it is not obvious (CONTRIBUTING.md): a comment
// that cites again, in brackets of its own, a record the file has cited already sends the reader nowhere new.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "apps", "packages", "site/src", "scripts"];
const CITE = /docs\/decisions\/(\d{4})-[a-z0-9-]+\.md|ADR (\d{4})/g;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "api-schema.ts") return [];
    if (entry.isDirectory()) return filesUnder(path);
    return /\.(ts|tsx|astro|css)$/.test(path) ? [path] : [];
  });
}

/** Each comment's citation, alone in its brackets, of a record the file cited before it. */
function repeatsIn(file: string): string[] {
  const seen = new Set<string>();
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) =>
      [...line.matchAll(CITE)].flatMap((match) => {
        const record = match[1] ?? match[2] ?? "";
        const start = match.index;
        const end = start + match[0].length;
        const alone = COMMENT.test(line) && line.slice(start - 2, start) === " (" && line[end] === ")";
        const repeat = alone && seen.has(record);
        seen.add(record);
        return repeat ? [`${file}:${String(index + 1)}: ${record}`] : [];
      }),
    );
}

describe("a file's citations of the decision records", () => {
  it("name each record once, never again in brackets of their own", () => {
    expect(ROOTS.flatMap(filesUnder).flatMap(repeatsIn)).toEqual([]);
  });
});
