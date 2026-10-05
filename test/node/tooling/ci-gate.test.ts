// The gate the CI workflow's last jobs decide (scripts/ci/ci-gate.ts): a skipped job had nothing it could affect, or had
// passed on these files already, so it passes; anything else a job can end as fails the gate.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { failedJobs } from "../../../scripts/lib/ci-gate.ts";

const RESULTS = `
  changes success
  static skipped
  tests success
  build failure
  browser cancelled
  smoke skipped
`;

describe("the CI gate", () => {
  it("passes a job that passed or was skipped, and names every other", () => {
    expect(failedJobs(RESULTS)).toEqual(["build", "browser"]);
    expect(failedJobs("changes success\nstatic skipped\n")).toEqual([]);
  });

  it("names a job whose result is missing, as GitHub leaves one that never started", () => {
    expect(failedJobs("build\n")).toEqual(["build"]);
  });

  it("fails the job, naming what did not pass, and passes it otherwise", () => {
    const run = (results: string) =>
      spawnSync(process.execPath, ["scripts/ci/ci-gate.ts", "checks"], {
        encoding: "utf8",
        env: { ...process.env, RESULTS: results },
      });
    const failed = run(RESULTS);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("::error::these checks did not pass: build browser");
    expect(run("build success\nsmoke skipped").status).toBe(0);
  });
});
