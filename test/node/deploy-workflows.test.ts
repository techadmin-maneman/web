// The deploy workflows run on main and by hand, never on a pull request, so a
// mistake in them is found by a deploy. What they must keep to is pinned here;
// what they decide lives in scripts and has tests of its own
// (test/node/release.test.ts, docs/decisions/0006-deployment-pipeline.md).

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FULL_SUITE_JOB, REUSABLE_CHECKS, type ReusableCheck } from "../../scripts/lib/already-checked.ts";
import { WORKERS } from "../../scripts/lib/workers.ts";

const DEPLOYS = [
  ["deploy-staging.yml", "staging"],
  ["deploy-production.yml", "production"],
] as const;

const workflow = (file: string) => readFileSync(`.github/workflows/${file}`, "utf8");

describe.each(DEPLOYS)("%s", (file, environment) => {
  const text = workflow(file);

  it("never lets a failed command read as an empty answer", () => {
    expect(text).not.toContain("|| true");
    // `echo "x=$(cmd)"` succeeds whatever cmd does; an assignment of its own fails the step when cmd fails.
    expect(text).not.toMatch(/echo "[^"\n]*\$\(/);
  });

  it("checks the database is this environment's, and uploads mm-api, before any migration runs", () => {
    const migrate = text.indexOf("d1 migrations apply");
    const identity = text.indexOf(`mark-database.ts ${environment} --check`);
    const upload = text.indexOf(`release.ts upload --worker mm-api --env ${environment}`);
    expect(migrate).toBeGreaterThan(0);
    expect(identity).toBeGreaterThan(0);
    expect(identity).toBeLessThan(migrate);
    // A version upload fails on a binding whose bucket, queue or database is missing, and sends no traffic.
    expect(upload).toBeGreaterThan(0);
    expect(upload).toBeLessThan(migrate);
  });

  it("never builds an app with its placeholder copy let through", () => {
    expect(text).not.toContain("--allow-placeholders");
  });

  it("smokes every switched-on surface against the commit it deployed", () => {
    expect(text).toMatch(/npm run smoke -- --environment \w+ --surfaces --version-tag "\$SHA"/);
  });
});

describe("the production release", () => {
  const text = workflow("deploy-production.yml");

  it.each(WORKERS)("records what $name serves before it starts, and restores it on a failure", (worker) => {
    expect(text).toContain(`release.ts current --worker ${worker.name} --env production`);
    expect(text).toContain(`--to "${worker.name}=`);
  });

  it("restores whatever a failed deploy left serving, not only what a finished deploy step did", () => {
    expect(text).not.toMatch(/steps\.\w+\.outcome }}" == "success"/);
  });
});

describe("ci.yml on a pull request", () => {
  const text = workflow("ci.yml");
  /** One job's block, from its key to the next job's. */
  const jobOf = (key: string) => text.split(`\n  ${key}:\n`)[1]?.split(/\n {2}[a-z-]+:\n/)[0] ?? "";

  it("runs the full suite on every push, and nothing when a label is added", () => {
    expect(text).toContain("types: [opened, synchronize, reopened, ready_for_review]\n");
    expect(text).not.toContain("labeled");
    expect(text).not.toContain("github.event.label");
    for (const key of ["static", "tests", "build", "browser", "smoke", "old-code-on-new-schema"]) {
      expect(jobOf(key), key).toContain("runs-on:");
      expect(jobOf(key), key).not.toContain("outputs.full");
    }
  });

  it("tests every browser-test project the config declares, then runs Lighthouse", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    const declared = [...config.matchAll(/^ {6}name: "([^"]+)",$/gm)].map((match) => match[1]);
    const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    const run = [...(scripts["test:e2e"] ?? "").matchAll(/--project=(\S+)/g)].map((match) => match[1]);
    expect(declared).toEqual(["390", "1440", "app", "ops", "tech", "tech-ios"]);
    expect(run).toEqual(declared);

    const browser = jobOf("browser");
    expect(browser).toContain("run: npm run test:e2e\n");
    expect(browser).toMatch(/- name: Lighthouse[^\n]*\n\s+run: npm run lighthouse\n/);
  });

  it("names the job a later run looks for before it takes the full suite as passed", () => {
    expect(jobOf("full-suite")).toContain(`name: ${FULL_SUITE_JOB}\n`);
    // When `what changed` failed, every job of the suite was skipped untested: that is no pass.
    expect(jobOf("full-suite")).toContain("needs.changes.result == 'success'");
    expect(jobOf("checks")).toContain("full-suite");
  });

  // "Checks are not repeated": each check a run can take as passed is skipped when these files already passed it.
  it("skips each check these very files already passed, under the job name a later run looks for", () => {
    const skippedWhen: Record<ReusableCheck, string[]> = {
      static: ["static"],
      tests: ["tests"],
      suite: ["build", "browser", "smoke", "old-code-on-new-schema"],
    };
    for (const [check, keys] of Object.entries(skippedWhen) as [ReusableCheck, string[]][]) {
      for (const key of keys) {
        expect(jobOf(key), key).toContain(`needs.changes.outputs.${check}-passed != 'true'`);
      }
      expect(text, check).toContain(`${check}-passed: \${{ steps.passed.outputs.${check} }}`);
    }
    expect(jobOf("static")).toContain(`name: ${REUSABLE_CHECKS.static}`);
    expect(jobOf("tests")).toContain(`name: ${REUSABLE_CHECKS.tests}`);
  });

  it("asks a pull request's earlier runs only when this run checks the head's own files", () => {
    const step = jobOf("changes").split("- name: The checks these files already passed")[1] ?? "";
    expect(step).toContain(`elif [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "$HEAD_SHA^{tree}")" ]; then`);
    expect(step).toContain('--head "$HEAD_SHA"');
  });
});

// The repository is public: anyone can open a pull request from a fork.
describe("a fork's pull request", () => {
  it("never runs with a secret or a write token, and never runs its code where one is", () => {
    for (const file of readdirSync(".github/workflows")) {
      expect(workflow(file), file).not.toContain("pull_request_target");
    }
    expect(workflow("ci.yml")).not.toContain("secrets.");
    expect(workflow("ci.yml")).not.toMatch(/: write$/m);
  });

  it("is never merged by auto-merge, which runs main's own scripts", () => {
    const text = workflow("auto-merge.yml");
    expect(text).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    expect(text).not.toMatch(/^\s+ref:/m);
  });
});

describe("deploy-staging.yml", () => {
  it("runs CI on what merged, which takes as passed what the merged pull request passed, and deploys only on a pass", () => {
    const text = workflow("deploy-staging.yml");
    expect(text).toContain("uses: ./.github/workflows/ci.yml");
    expect(text).toContain("if: ${{ !cancelled() && needs.checks.result == 'success' }}");
    expect(text).not.toContain("needs.checks.result == 'skipped'");
  });
});
