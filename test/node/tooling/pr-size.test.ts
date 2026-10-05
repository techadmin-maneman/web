// CI warns when a pull request changes more lines by hand than one review reads well (scripts/lib/pr-size.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handWrittenLines, isGenerated } from "../../../scripts/lib/pr-size.ts";

describe("the lines a pull request changes by hand", () => {
  it("adds the lines added and deleted in each file", () => {
    expect(handWrittenLines("10\t2\tsrc/domain/refunds.ts\n5\t0\ttest/worker/refunds.test.ts\n")).toBe(17);
  });

  it("leaves out what npm run openapi, schema and types write, and the lockfile", () => {
    const numstat = [
      "3000\t20\tdocs/openapi-client.json",
      "900\t10\tdocs/api-client.md",
      "400\t0\tdocs/api.md",
      "300\t0\tdocs/schema.md",
      "800\t40\tapps/app/src/api-schema.ts",
      "50\t0\tsite/src/lib/api-schema.ts",
      "20\t0\tsrc/worker-configuration.d.ts",
      "500\t300\tpackage-lock.json",
      "33\t0\tsrc/routes/client/booking.ts",
    ].join("\n");
    expect(handWrittenLines(numstat)).toBe(33);
  });

  it("counts a binary file, which git shows as -, as nothing", () => {
    expect(handWrittenLines("-\t-\tdocs/fidelity/home.jpg\n1\t1\tREADME.md")).toBe(2);
  });

  it("does not mistake a hand-written file for a generated one", () => {
    expect(isGenerated("src/openapi.ts")).toBe(false);
    expect(isGenerated("docs/api-notes.md")).toBe(false);
    expect(isGenerated("docs/runbook.md")).toBe(false);
    expect(isGenerated("scripts/build/generate-openapi.ts")).toBe(false);
  });
});

describe("the review budget step in CI", () => {
  it("runs on every pull request and only warns", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain(`run: git diff --numstat "$BASE...HEAD" | node scripts/ci/pr-size.ts`);
    const script = readFileSync("scripts/ci/pr-size.ts", "utf8");
    expect(script).toContain("::warning::");
    expect(script).not.toContain("process.exit");
  });
});

describe(".gitattributes", () => {
  // GitHub folds what it marks; the budget leaves out what isGenerated names: the two lists are one.
  it("marks as generated the files the budget leaves out, and the fidelity pictures", () => {
    const marked = readFileSync(".gitattributes", "utf8")
      .split("\n")
      .filter((line) => line.includes("linguist-generated"))
      .map((line) => line.split(/\s+/)[0] ?? "");
    expect(marked).toContain("docs/fidelity/**");
    expect(marked.filter((path) => !path.endsWith("/**") && !isGenerated(path))).toEqual([]);
  });
});
