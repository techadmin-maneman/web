// No check of CI runs twice on the same files (scripts/already-checked.ts, docs/decisions/0006-deployment-pipeline.md,
// "Checks are not repeated"): a run takes as passed each check an earlier run passed on exactly its files. Anything
// uncertain runs every check.

import { describe, expect, it } from "vitest";
import { alreadyChecked, REUSABLE_CHECKS, type GitHubGet } from "../../scripts/lib/already-checked.ts";

const MERGE = "a".repeat(40);
const HEAD = "b".repeat(40);

interface Repo {
  pulls?: unknown;
  mergeTree?: string;
  headTree?: string;
  /** The jobs of each of the head's ci runs, by name and conclusion. */
  runs?: Record<string, string>[];
  failing?: string;
}

const FULL = {
  "static checks": "success",
  "tests (unit, contract, coverage)": "success",
  "full suite": "success",
};
const SUITE_FAILED = {
  "static checks": "success",
  "tests (unit, contract, coverage)": "success",
  "full suite": "failure",
};

/** A fake GitHub API over one merged pull request. */
function github(repo: Repo = {}): GitHubGet {
  return (path) => {
    if (repo.failing !== undefined && path.includes(repo.failing)) return Promise.reject(new Error("HTTP 502"));
    if (path === `/repos/o/r/commits/${MERGE}/pulls`) {
      return Promise.resolve(repo.pulls ?? [{ number: 7, merge_commit_sha: MERGE, head: { sha: HEAD } }]);
    }
    if (path === `/repos/o/r/git/commits/${MERGE}`) return Promise.resolve({ tree: { sha: repo.mergeTree ?? "t1" } });
    if (path === `/repos/o/r/git/commits/${HEAD}`) return Promise.resolve({ tree: { sha: repo.headTree ?? "t1" } });
    const runs = repo.runs ?? [FULL];
    if (path.startsWith("/repos/o/r/actions/workflows/ci.yml/runs?")) {
      expect(path).toContain(`head_sha=${HEAD}`);
      expect(path).toContain("event=pull_request");
      return Promise.resolve({ total_count: runs.length, workflow_runs: runs.map((_, index) => ({ id: index })) });
    }
    const job = /^\/repos\/o\/r\/actions\/runs\/(\d+)\/jobs/.exec(path);
    if (job !== null) {
      const jobs = runs[Number(job[1])] ?? {};
      return Promise.resolve({ jobs: Object.entries(jobs).map(([name, conclusion]) => ({ name, conclusion })) });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  };
}

describe("a staging deploy's merge", () => {
  it("takes as passed every check its pull request's head passed, when the merge has the head's files", async () => {
    const answer = await alreadyChecked("o/r", MERGE, github());
    expect(answer.passed).toEqual(["static", "tests", "suite"]);
    expect(answer.reason).toContain("#7");
  });

  it("takes each check's pass on its own, and runs only the full suite that failed", async () => {
    expect((await alreadyChecked("o/r", MERGE, github({ runs: [SUITE_FAILED] }))).passed).toEqual(["static", "tests"]);
  });

  it("gathers the passes from every run on the head, a failed run's passing jobs among them", async () => {
    const failedTests = { "static checks": "success", "tests (unit, contract, coverage)": "failure" };
    const answer = await alreadyChecked("o/r", MERGE, github({ runs: [failedTests, SUITE_FAILED] }));
    expect(answer.passed).toEqual(["static", "tests"]);
  });

  it("takes nothing as passed that only skipped, failed or was cancelled", async () => {
    const nothing = {
      "static checks": "cancelled",
      "tests (unit, contract, coverage)": "failure",
      "full suite": "skipped",
    };
    expect((await alreadyChecked("o/r", MERGE, github({ runs: [nothing] }))).passed).toEqual([]);
  });

  it("takes nothing as passed when its files differ from the head, as when main moved on after the checks", async () => {
    expect((await alreadyChecked("o/r", MERGE, github({ headTree: "t0" }))).passed).toEqual([]);
  });

  it("takes nothing as passed for a push that no pull request merged", async () => {
    expect((await alreadyChecked("o/r", MERGE, github({ pulls: [] }))).passed).toEqual([]);
    const another = [{ number: 8, merge_commit_sha: "c".repeat(40), head: { sha: HEAD } }];
    expect((await alreadyChecked("o/r", MERGE, github({ pulls: another }))).passed).toEqual([]);
  });

  it("takes nothing as passed when GitHub could not tell us: every check runs", async () => {
    const answer = await alreadyChecked("o/r", MERGE, github({ failing: "/actions/" }));
    expect(answer).toEqual({ passed: [], reason: "could not tell (HTTP 502), so every check runs" });
  });
});

describe("a pull request's run on its head's own files", () => {
  it("takes as passed what an earlier run on the same head passed, as when the pull request is marked ready", async () => {
    const answer = await alreadyChecked("o/r", MERGE, github({ runs: [SUITE_FAILED] }), HEAD);
    expect(answer.passed).toEqual(["static", "tests"]);
  });

  it("asks nothing of the merge, which is the head's own files", async () => {
    const answer = await alreadyChecked("o/r", MERGE, github({ pulls: [], headTree: "t0" }), HEAD);
    expect(answer.passed).toEqual(["static", "tests", "suite"]);
  });
});

// The names here must be the jobs' names in ci.yml, or no pass would ever be found.
describe("the checks that can be taken as passed", () => {
  it("are the static checks, the unit and contract tests and the full suite", () => {
    expect(Object.values(REUSABLE_CHECKS)).toEqual(["static checks", "tests (unit, contract, coverage)", "full suite"]);
  });
});
