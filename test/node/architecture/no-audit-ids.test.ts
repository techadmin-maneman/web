// No audit's finding ID, milestone tag or package number in code, tests, styles or the API documents
// (CONTRIBUTING.md, "Comments"): each names a report outside the repository, or a plan long done, where the reason
// itself belongs.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** The areas the audits filed findings under. */
const AREAS = "FEO FEA OPS DS SEC VIS ARCH LIFE TCD INT REQ A11Y BIZ CLI CQ CQT UX FLD BK MON PS PLAT CP CA OIA".split(
  " ",
);
const ID = new RegExp(`\\b(?:(?:${AREAS.join("|")})-\\d+|P\\d-[MF]\\d+|P\\d-\\d{2})\\b`);

const FOLDERS = ["src", "apps", "packages", "site/src", "scripts", "test", "e2e"];
const CODE = /\.(ts|tsx|astro|mjs|css)$/;

/** Every tracked file the rule covers: the code and its tests, and the API documents generated from the routes. */
function covered(): string[] {
  const tracked = execFileSync("git", ["ls-files", ...FOLDERS, "docs"], { encoding: "utf8" }).split("\n");
  return tracked.filter(
    (file) =>
      (CODE.test(file) && !file.endsWith("api-schema.ts")) || /^docs\/(openapi[^/]*\.json|api-[a-z]+\.md)$/.test(file),
  );
}

describe("comments, test titles and the API documents", () => {
  it("know an ID when they see one", () => {
    // Written in parts, so this file holds none.
    for (const id of ["BK" + "-37", "A11Y" + "-8", "P2" + "-M4", "P3" + "-45"])
      expect(ID.test(`a comment (${id}).`), id).toBe(true);
    expect(ID.test("ADR 0075, open point 14, migration 0052")).toBe(false);
  });

  it("carry no audit ID, milestone tag or package number", () => {
    const found = covered().flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (ID.test(line) ? [`${file}:${String(index + 1)}: ${line.trim()}`] : [])),
    );
    expect(found).toEqual([]);
  });
});
