// A pull request's size as a reviewer reads it, and the generated files GitHub folds away (scripts/lib/pr-size.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED, isGenerated, writtenLines } from "../../scripts/lib/pr-size.ts";

describe("writtenLines", () => {
  it("counts lines added and removed in files people wrote, and none in generated files or pictures", () => {
    const numstat = [
      "12\t3\tsrc/routes/client-refer.ts",
      "400\t380\tdocs/openapi-client.json",
      "90\t10\tapps/app/src/api-schema.ts",
      "-\t-\tdocs/fidelity/390/home-01-hero.jpg",
      "-\t-\tsite/public/images/invite-house.jpg",
      "5\t0\ttest/worker/referrals.test.ts",
    ].join("\n");
    expect(writtenLines(numstat)).toBe(20);
  });

  it("knows a folder's files, and a path only where it is written out", () => {
    expect(isGenerated("docs/fidelity/ops/a1-dispatch.jpg")).toBe(true);
    expect(isGenerated("docs/fidelity-method.md")).toBe(false);
    expect(isGenerated("docs/api.md")).toBe(true);
    expect(isGenerated("docs/api-guide.md")).toBe(false);
  });
});

describe(".gitattributes", () => {
  it("marks exactly the generated files as generated, so GitHub folds them in a diff", () => {
    const marked = readFileSync(".gitattributes", "utf8")
      .split("\n")
      .filter((line) => line.includes("linguist-generated"))
      .map((line) => line.split(/\s+/)[0] ?? "");
    expect(marked).toEqual(GENERATED.map((entry) => (entry.endsWith("/") ? `${entry}**` : entry)));
  });
});
