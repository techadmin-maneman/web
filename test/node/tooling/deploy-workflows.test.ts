// The deploy workflows run on main and by hand, never on a pull request, so a mistake in them is found by a deploy.
// What they must keep to is held here, on the workflows as GitHub reads them (./workflows.ts): which steps run, in
// what order, on what condition. What they decide lives in scripts and has tests of its own
// (test/node/tooling/release.test.ts, docs/decisions/0205-the-pipeline-as-it-runs.md).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FULL_SUITE_JOB, REUSABLE_CHECKS, type ReusableCheck } from "../../../scripts/lib/already-checked.ts";
import { WORKERS } from "../../../scripts/lib/workers.ts";
import { allSteps, jobOf, needsOf, placeOf, runStep, stepOf, workflow, WORKFLOW_FILES, type Job } from "./workflows.ts";

const DEPLOYS = [
  ["deploy-staging.yml", "deploy", "staging"],
  ["deploy-production.yml", "release", "production"],
] as const;

const scripts = (job: Job) => (job.steps ?? []).map((step) => step.run ?? "");

describe.each(DEPLOYS)("%s", (file, key, environment) => {
  const job = jobOf(workflow(file), key);

  it("never lets a failed command read as an empty answer", () => {
    for (const run of scripts(job)) {
      expect(run).not.toContain("|| true");
      // `echo "x=$(cmd)"` succeeds whatever cmd does; an assignment of its own fails the step when cmd fails.
      expect(run).not.toMatch(/echo "[^"\n]*\$\(/);
    }
    // Only a read-only report, once everything has shipped, may fail without failing the deploy.
    const reports = /^node scripts\/(release\/check-(triggers|buckets)|ops\/cpu-report)\.ts \w+$/;
    const mayFail = job.steps?.filter((step) => step["continue-on-error"] === true) ?? [];
    expect(mayFail.filter((step) => !reports.test(step.run?.trim() ?? ""))).toEqual([]);
  });

  it("checks the database is this environment's, and uploads mm-api, before any migration runs", () => {
    const migrate = placeOf(job, "d1 migrations apply");
    expect(migrate).toBeGreaterThan(0);
    expect(placeOf(job, `mark-database.ts ${environment} --check`)).toBeGreaterThan(0);
    expect(placeOf(job, `mark-database.ts ${environment} --check`)).toBeLessThan(migrate);
    // A version upload fails on a binding whose bucket, queue or database is missing, and sends no traffic.
    expect(placeOf(job, `release.ts upload --worker mm-api --env ${environment}`)).toBeGreaterThan(0);
    expect(placeOf(job, `release.ts upload --worker mm-api --env ${environment}`)).toBeLessThan(migrate);
  });

  it("never builds an app with its placeholder copy let through", () => {
    for (const run of scripts(job)) expect(run).not.toContain("--allow-placeholders");
  });

  it("smokes every switched-on surface against the commit it deployed", () => {
    const shipped = job.steps?.findIndex((step) => step.name === "Deploy mm-tech") ?? -1;
    expect(shipped).toBeGreaterThan(0);
    expect(placeOf(job, `--surfaces --version-tag "$SHA"`)).toBeGreaterThan(shipped);
  });
});

describe("the production release", () => {
  const release = jobOf(workflow("deploy-production.yml"), "release");
  const rollBack = stepOf(release, "Roll back");

  it.each(WORKERS)("records what $name serves before it starts, and restores it on a failure", (worker) => {
    expect(placeOf(release, `release.ts current --worker ${worker.name} --env production`)).toBeGreaterThan(-1);
    expect(placeOf(release, `release.ts current --worker ${worker.name} --env production`)).toBeLessThan(
      placeOf(release, "d1 migrations apply"),
    );
    expect(rollBack.run).toContain(`--to "${worker.name}=`);
  });

  // It rolled back only after a deploy step that finished, so one that failed half-way left its half serving.
  it("restores whatever a failed deploy left serving, once traffic has moved", () => {
    expect(rollBack.if).toBe("failure() && steps.canary.outcome != 'skipped'");
    expect(release.steps?.find((step) => step.id === "canary")?.name).toMatch(/^Send the new version/);
  });

  // Before mm-site ships, the site is the one serving before the release: at launch the bare placeholder of September,
  // with none of the site's headers, which would fail the release's own smokes and roll it back.
  it("smokes mm-api alone until mm-site ships, and the whole site once it has", () => {
    const shipsSite = placeOf(release, "ship --worker mm-site");
    const smokes = (release.steps ?? []).flatMap((step, place) =>
      step.run?.includes("npm run smoke -- --base") === true ? [{ place, run: step.run }] : [],
    );
    const beforeSite = smokes.filter((smoke) => smoke.place < shipsSite);
    expect(beforeSite).toHaveLength(3);
    for (const smoke of beforeSite) expect(smoke.run).toContain("${{ steps.before.outputs.api_only }}");
    expect(stepOf(release, "Final smoke").run).not.toContain("api_only");
    expect(rollBack.env?.API_ONLY).toBe("${{ steps.before.outputs.api_only }}");
    expect(rollBack.run).toContain("$API_ONLY");
  });

  it("checks mm-api alone only where the commit's own smoke knows how", () => {
    const record = stepOf(release, "Record the versions serving now");
    const node = 'echo "v-1"';
    expect(runStep(record, { node, grep: "exit 0" }).outputs.api_only).toBe("--api-only");
    expect(runStep(record, { node, grep: "exit 1" }).outputs.api_only).toBe("");
  });

  it("lets the policy check past Access, which keeps the console's host and, until the doors open, the apps'", () => {
    const check = stepOf(release, "No production page refuses anything under its content security policy");
    expect(check.env).toEqual({
      CF_ACCESS_CLIENT_ID: "${{ secrets.CF_ACCESS_CLIENT_ID }}",
      CF_ACCESS_CLIENT_SECRET: "${{ secrets.CF_ACCESS_CLIENT_SECRET }}",
    });
  });

  // The check ran before the apps' Workers shipped, so a release's own pages there went unchecked.
  it("opens every production host's pages once every Worker has shipped and been smoked", () => {
    const check = placeOf(release, "smoke:csp -- --environment production");
    expect(check).toBeGreaterThan(release.steps?.findIndex((step) => step.name === "Deploy mm-tech") ?? Infinity);
    expect(check).toBeGreaterThan(placeOf(release, "--surfaces --version-tag"));
  });
});

describe("ci.yml on a pull request", () => {
  const CI = workflow("ci.yml");
  const on = CI.on as { pull_request?: { types?: string[] } };

  it("runs the full suite on every push, and nothing when a label is added", () => {
    expect(on.pull_request?.types).toEqual(["opened", "synchronize", "reopened", "ready_for_review"]);
    for (const key of ["static", "tests", "build", "browser", "smoke", "old-code-on-new-schema"]) {
      expect(jobOf(CI, key)["runs-on"], key).toMatch(/^ubuntu-(latest|\d{2}\.04)$/);
      expect(jobOf(CI, key).if ?? "", key).not.toContain("outputs.full");
    }
    expect(allSteps(CI).filter(({ step }) => step.if?.includes("github.event.label") === true)).toEqual([]);
  });

  it("tests every browser-test project the config declares, in two halves, then runs Lighthouse once", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    const declared = [...config.matchAll(/^ {6}name: "([^"]+)",$/gm)].map((match) => match[1]);
    const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    const run = [...(scripts["test:e2e"] ?? "").matchAll(/--project=(\S+)/g)].map((match) => match[1]);
    expect(declared).toEqual(["390", "1440", "app", "ops", "tech", "tech-live", "tech-ios"]);
    expect(run).toEqual(declared);

    const browser = jobOf(CI, "browser");
    expect(browser.strategy?.matrix?.part).toEqual([1, 2, 3, 4, "lighthouse"]);
    const tests = browser.steps?.find(
      (step) => step.run?.trim() === "npm run test:e2e -- --shard=${{ matrix.part }}/4",
    );
    expect(tests?.if).toBe("matrix.part != 'lighthouse'");
    const lighthouse = browser.steps?.find((step) => step.run?.trim() === "npm run lighthouse");
    expect(lighthouse?.if).toBe("matrix.part == 'lighthouse'");
  });

  it("names the job a later run looks for before it takes the full suite as passed", () => {
    const full = jobOf(CI, "full-suite");
    expect(full.name).toBe(FULL_SUITE_JOB);
    // When `what changed` failed, every job of the suite was skipped untested: that is no pass.
    expect(full.if).toContain("needs.changes.result == 'success'");
    expect(needsOf(jobOf(CI, "checks"))).toContain("full-suite");
  });

  // "Checks are not repeated": each check a run can take as passed is skipped when these files already passed it.
  it("skips each check these very files already passed, under the job name a later run looks for", () => {
    const skippedWhen: Record<ReusableCheck, string[]> = {
      static: ["static"],
      tests: ["unit", "tests"],
      suite: ["build", "browser", "smoke", "old-code-on-new-schema"],
    };
    const changes = jobOf(CI, "changes");
    for (const [check, keys] of Object.entries(skippedWhen) as [ReusableCheck, string[]][]) {
      for (const key of keys)
        expect(jobOf(CI, key).if, key).toContain(`needs.changes.outputs.${check}-passed != 'true'`);
      expect(changes.outputs?.[`${check}-passed`], check).toBe(`\${{ steps.passed.outputs.${check} }}`);
    }
    expect(jobOf(CI, "static").name).toBe(REUSABLE_CHECKS.static);
    expect(jobOf(CI, "tests").name).toBe(REUSABLE_CHECKS.tests);
  });

  it("asks a pull request's earlier runs only when this run checks the head's own files", () => {
    const step = stepOf(jobOf(CI, "changes"), "The checks these files already passed");
    expect(step.id).toBe("passed");
    expect(step.run).toContain(
      `elif [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "$HEAD_SHA^{tree}")" ]; then`,
    );
    expect(step.run).toContain('--head "$HEAD_SHA"');
  });
});

// The repository is public: anyone can open a pull request from a fork.
describe("a fork's pull request", () => {
  it("never runs with a secret or a write token, and never runs its code where one is", () => {
    for (const file of WORKFLOW_FILES) {
      expect(Object.keys(workflow(file).on as object), file).not.toContain("pull_request_target");
    }
    const CI = workflow("ci.yml");
    expect(CI.permissions).toEqual({ contents: "read" });
    for (const [key, job] of Object.entries(CI.jobs)) {
      expect(Object.values(job.permissions ?? {}), key).not.toContain("write");
    }
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).not.toContain("secrets.");
  });

  it("is never merged by auto-merge, which runs main's own scripts", () => {
    const merge = jobOf(workflow("auto-merge.yml"), "merge");
    expect(merge.if).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    expect(merge.steps?.filter((step) => step.with?.ref !== undefined)).toEqual([]);
  });
});

describe("deploy-staging.yml", () => {
  const flow = workflow("deploy-staging.yml");
  const deploy = jobOf(flow, "deploy");

  it("runs CI on what merged, which takes as passed what the merged pull request passed, and deploys only on a pass", () => {
    expect(jobOf(flow, "checks").uses).toBe("./.github/workflows/ci.yml");
    expect(needsOf(deploy)).toEqual(["checks"]);
    expect(deploy.if).toBe("${{ !cancelled() && needs.checks.result == 'success' }}");
  });

  it("opens every staging host's pages after the smoke, and fails the deploy on a policy refusal", () => {
    const check = deploy.steps?.find((step) => step.run?.includes("npm run smoke:csp -- --environment staging"));
    expect(check).toBeDefined();
    expect(check?.["continue-on-error"]).toBeUndefined();
    expect(placeOf(deploy, "smoke:csp")).toBeGreaterThan(placeOf(deploy, "--surfaces --version-tag"));
  });
});

describe("watch-production.yml", () => {
  const flow = workflow("watch-production.yml");
  const watch = jobOf(flow, "watch");
  const gate = stepOf(watch, "Whether to watch now");
  const LIVE = '<!doctype html><meta name="mm-worker" content="mm-site" /><title>Mane Man</title>';
  const decide = (page: string, releasing = "0") =>
    runStep(gate, { gh: `echo ${releasing}`, curl: `printf '%s' '${page}'` }).outputs.live;

  it("checks the live site, and a site answering anything else, an error included", () => {
    expect(decide(LIVE)).toBe("true");
    expect(decide("error code: 1101")).toBe("true");
    expect(decide("")).toBe("true");
  });

  it("stands down while production serves the placeholder of September, or while a release splits mm-api", () => {
    expect(decide("<p>Mane Man. Placeholder for the production site.</p>")).toBe("false");
    expect(decide(LIVE, "1")).toBe("false");
  });

  // A live site wrongly marked noindex is a fault to be told of, never a reason to check nothing.
  it("checks a live site marked noindex", () => {
    expect(
      decide('<meta name="robots" content="noindex, nofollow" /><meta name="mm-worker" content="mm-site" />'),
    ).toBe("true");
  });

  it("runs every check only when it watches, and tells someone when one fails", () => {
    for (const step of (watch.steps ?? []).slice(2)) expect(step.if).toBe("steps.live.outputs.live == 'true'");
    expect(jobOf(flow, "tell").if).toBe("${{ failure() }}");
  });
});
