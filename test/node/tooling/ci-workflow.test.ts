// What CI's own steps must keep to (.github/workflows/ci.yml), read as GitHub reads it and, where a step's script
// decides something, run with the commands it calls faked (./workflows.ts). A step that fails on a blip wastes a run;
// one that never fails checks nothing. actionlint, in the static job, checks the rest of the file's shape.

import { describe, expect, it } from "vitest";
import { jobOf, runStep, stepOf, workflow, WORKFLOW_FILES } from "./workflows.ts";

const CI = workflow("ci.yml");
const signatures = stepOf(jobOf(CI, "static"), "Registry signatures");
/** npm failing its first `fails` calls; sleep only recorded. */
const fakes = (fails: number) => ({
  npm: `n=$(wc -l < "$(dirname "$0")/../npm.calls"); [ "$n" -gt ${String(fails)} ]`,
  sleep: "true",
});

describe("the registry signatures step", () => {
  // npm now and then fails it with EMISSINGSIGNATUREKEY, a registry blip that a later try clears. On 28 September
  // 2026 a second try 15 seconds on failed three runs in a row.
  it("passes on the first try that verifies, half a minute after the one before", () => {
    const ran = runStep(signatures, fakes(2));
    expect(ran.status).toBe(0);
    expect(ran.calls.npm).toEqual(["audit signatures", "audit signatures", "audit signatures"]);
    expect(ran.calls.sleep).toEqual(["30", "30"]);
  });

  it("fails the step once four tries have failed, waiting after none but the first three", () => {
    const ran = runStep(signatures, fakes(4));
    expect(ran.status).toBe(1);
    expect(ran.calls.npm).toHaveLength(4);
    expect(ran.calls.sleep).toEqual(["30", "30", "30"]);
    expect(signatures["continue-on-error"]).toBeUndefined();
  });

  // npm's signature check fails for days at a time, so it runs only where a package comes in: a signature is
  // verified when a lockfile brings the package in, and the lockfile's integrity hash holds every later install to
  // those bytes.
  it("runs when a pull request changes a package.json or the lockfile, and only then", () => {
    expect(signatures.if).toBe("needs.changes.outputs.dependencies == 'true'");
    expect(jobOf(CI, "changes").outputs?.dependencies).toBe("${{ steps.filter.outputs.dependencies }}");
    const filter = stepOf(jobOf(CI, "changes"), "Anything a build, a Worker or a browser can see, and any migration");
    expect(filter.id).toBe("filter");
    const changed = (files: string[]) =>
      runStep(filter, { git: `printf '%s\\n' ${files.map((file) => `'${file}'`).join(" ")}` }, { BASE: "origin/main" })
        .outputs.dependencies;
    expect(changed(["src/app.ts", "apps/app/package.json"])).toBe("true");
    expect(changed(["package-lock.json"])).toBe("true");
    expect(changed(["src/app.ts", "docs/runbook.md"])).not.toBe("true");
  });
});

// The repository is public: a self-hosted runner would run a fork's pull request on the machine it lives on.
describe("where every workflow runs", () => {
  it.each(WORKFLOW_FILES)(
    "is GitHub's own runners in %s, named in each job, with no variable that could move it",
    (file) => {
      const jobs = Object.values(workflow(file).jobs);
      expect(jobs.length).toBeGreaterThan(0);
      for (const job of jobs) {
        // A job that calls a reusable workflow runs where that workflow's own jobs say. A job may name an Ubuntu
        // release when ubuntu-latest moves on before a tool it runs does.
        if (job.uses === undefined) expect(job["runs-on"]).toMatch(/^ubuntu-(latest|\d{2}\.04)$/);
      }
    },
  );
});
