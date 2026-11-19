// CI's browser jobs run in Playwright's own image, which must be the version the lockfile installs
// (scripts/lib/playwright-image.ts).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { playwrightImageProblems } from "../../../scripts/lib/playwright-image.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("CI's Playwright image", () => {
  it("is the version the lockfile installs, pinned by its digest", () => {
    const installed = (createRequire(import.meta.url)("@playwright/test/package.json") as { version: string }).version;
    expect(playwrightImageProblems(readFileSync(".github/workflows/ci.yml", "utf8"), installed)).toEqual([]);
  });

  it("names an image of another version, and a workflow that names none", () => {
    const workflow = `image: mcr.microsoft.com/playwright:v1.64.0-noble@${DIGEST}`;
    expect(playwrightImageProblems(workflow, "1.65.0")).toEqual([
      "the Playwright image is v1.64.0, the lockfile installs 1.65.0: bump them together",
    ]);
    expect(playwrightImageProblems("image: node:24", "1.65.0")).toEqual([
      "no Playwright image, pinned by its digest, is named",
    ]);
  });
});
