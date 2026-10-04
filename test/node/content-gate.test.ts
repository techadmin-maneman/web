// Phase 2's copy is marked PLACEHOLDER where the owner has not yet given the
// wording. Staging ships it by the owner's ruling; a production build must not
// (scripts/lib/content-gate.ts).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTENT_FILES, contentProblems, placeholderMarks } from "../../scripts/lib/content-gate.ts";

const SOURCE = [
  "// Every word the app shows. A component holds no copy of its own. Lines the",
  "// design does not draw are marked PLACEHOLDER, pending the owner's wording.",
  "",
  "export const signIn = {",
  "  // PLACEHOLDER: the design draws no error.",
  '  error: "Something went wrong",',
  "  /** PLACEHOLDER wording; the design's is another. */",
  '  label: "Your number",',
  '  pincode: { placeholder: "122018" },',
  "};",
].join("\n");

describe("a PLACEHOLDER mark", () => {
  it("is on each line that carries the word, after the opening comment that explains it", () => {
    expect(placeholderMarks(SOURCE)).toEqual([5, 7]);
  });

  it("is on no line of a file whose only mention is that opening comment", () => {
    const settled = SOURCE.split("\n")
      .filter((line) => !line.includes("  // PLACEHOLDER") && !line.includes("/** PLACEHOLDER"))
      .join("\n");
    expect(placeholderMarks(settled)).toEqual([]);
  });
});

describe("the production gate on Phase 2's copy", () => {
  // CQ-43 and CP-26 of the 2 Oct audit: the site's own marks, the job sheet and the WhatsApp texts went ungated.
  it("covers each app's content, the site's, the referral landing's and the API's", () => {
    expect(CONTENT_FILES).toEqual({
      site: ["site/src/content/referral.ts", "site/src/content/site.ts"],
      app: ["apps/app/src/content.ts"],
      ops: ["apps/ops/src/content.ts"],
      tech: ["apps/tech/src/content.ts"],
      api: ["src/config/job-sheet.ts", "src/config/message-templates.ts"],
    });
  });

  it("refuses a production release of the API while its copy holds a mark", () => {
    const marked = CONTENT_FILES.api.some((file) => placeholderMarks(readFileSync(file, "utf8")).length > 0);
    const check = spawnSync(process.execPath, ["scripts/check-copy.ts", "api"], { encoding: "utf8" });
    expect(check.status).toBe(marked ? 1 : 0);
    if (marked) expect(check.stderr).toContain("src/config/job-sheet.ts");
  });

  it("names each file still marked, how many lines, and where the first are", () => {
    const files: Record<string, string> = { "a.ts": SOURCE, "b.ts": "export const done = 1;\n" };
    expect(contentProblems(["a.ts", "b.ts"], (file) => files[file] ?? "")).toEqual([
      "a.ts: 2 lines marked PLACEHOLDER, at 5, 7",
    ]);
  });

  it.each(["app", "ops", "tech"] as const)(
    "refuses a production build of %s while its copy holds a mark, before building anything",
    (app) => {
      const marked = CONTENT_FILES[app].some((file) => placeholderMarks(readFileSync(file, "utf8")).length > 0);
      if (!marked) return; // Every line has the owner's wording: the build is allowed, and builds.
      const build = spawnSync(process.execPath, [`scripts/build-${app}.ts`, "--env", "production"], {
        encoding: "utf8",
      });
      expect(build.status).toBe(1);
      expect(build.stderr).toContain("The production build is blocked");
      expect(build.stderr).toContain(`apps/${app}/src/content.ts`);
    },
  );
});
