// A doc comment sits directly on what it documents: a blank line or another comment after it means the declaration it
// was written for moved or went, and the comment now reads as the next one's.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = execFileSync("git", ["ls-files", "src", "apps", "packages", "site/src", "scripts"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts") && !file.includes("api-schema"));

/** Each doc comment followed by a blank line or by another comment, as "file:line". */
function strayDocComments(file: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const stray: string[] = [];
  lines.forEach((line, index) => {
    if (!line.trim().startsWith("/**")) return;
    let end = index;
    while (end < lines.length && !(lines[end] ?? "").includes("*/")) end += 1;
    const next = (lines[end + 1] ?? "").trim();
    // A file's own header, or a comment closing the file, documents nothing below it.
    if (end + 1 >= lines.length) return;
    if (next === "" || next.startsWith("/**") || next.startsWith("//")) stray.push(`${file}:${String(index + 1)}`);
  });
  return stray;
}

describe("doc comments", () => {
  it("each sit directly on the declaration they document", () => {
    expect(files.flatMap(strayDocComments)).toEqual([]);
  });
});
