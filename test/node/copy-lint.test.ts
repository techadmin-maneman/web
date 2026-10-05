// A mark is a comment, never a word in the copy itself: a label that began "PLACEHOLDER " reached technicians,
// clients and ops alike. The comment is what the production gate and the owner's
// texts file read (scripts/lib/content-gate.ts, scripts/lib/texts.ts).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCES = /^(src|apps\/\w+\/src|site\/src|packages)\/.*\.(ts|tsx|astro)$/;

describe("the copy", () => {
  it("never carries PLACEHOLDER inside a string", () => {
    const files = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .filter((file) => SOURCES.test(file) && !file.includes("/dist/"));
    const found = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (/["'`]PLACEHOLDER\b/.test(line) ? [`${file}:${String(index + 1)}`] : [])),
    );
    expect(found).toEqual([]);
  });
});
