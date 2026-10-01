// A pull request's browser tests run only for the apps its changes reach (scripts/lib/e2e-projects.ts, the owner's
// choice of 1 October 2026); anything shared reaches them all.

import { describe, expect, it } from "vitest";
import { ALL_PROJECTS, needsLighthouse, touchedProjects } from "../../scripts/lib/e2e-projects.ts";

describe("the browser-test projects a change reaches", () => {
  it("runs the site's widths for the site and its own tests", () => {
    expect(touchedProjects(["site/src/content/site.ts", "e2e/home.e2e.ts"])).toEqual(["390", "1440"]);
  });

  it("runs one app's project for that app and its tests", () => {
    expect(touchedProjects(["apps/app/src/content.ts"])).toEqual(["app"]);
    expect(touchedProjects(["e2e/ops/settings.e2e.ts"])).toEqual(["ops"]);
    expect(touchedProjects(["apps/tech/src/steps/CloseOut.tsx"])).toEqual(["tech", "tech-ios"]);
  });

  it("runs every project for anything shared: the API, the packages, the config, the test support", () => {
    for (const path of [
      "src/routes/tech-jobs.ts",
      "packages/brand/tokens.css",
      "migrations/0062_x.sql",
      "playwright.config.ts",
      "e2e/support.ts",
      "package-lock.json",
      ".github/workflows/ci.yml",
    ]) {
      expect(touchedProjects([path]), path).toEqual([...ALL_PROJECTS]);
    }
  });

  it("runs none for documentation, the design, or the deployed-staging proof", () => {
    expect(
      touchedProjects(["docs/runbook.md", "design/assets/nw-1.jpg", "README.md", "e2e/tech-staging/job.e2e.ts", ""]),
    ).toEqual([]);
  });

  it("joins what several changes reach, in the suite's order", () => {
    expect(touchedProjects(["apps/ops/src/App.tsx", "site/src/pages/index.astro"])).toEqual(["390", "1440", "ops"]);
  });

  it("measures Lighthouse when the site or the client app is tested", () => {
    expect(needsLighthouse(["app"])).toBe(true);
    expect(needsLighthouse(["390", "1440"])).toBe(true);
    expect(needsLighthouse(["ops", "tech", "tech-ios"])).toBe(false);
  });
});
