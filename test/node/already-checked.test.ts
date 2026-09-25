// A merge to main skips re-running CI only when the tree it deploys is exactly
// one whose pull request passed CI (scripts/already-checked.ts,
// docs/decisions/0006-deployment-pipeline.md). Anything uncertain runs it.

import { describe, expect, it } from "vitest";
import { alreadyChecked, type GitHubGet } from "../../scripts/lib/already-checked.ts";

const MERGE = "a".repeat(40);
const HEAD = "b".repeat(40);

interface Repo {
  pulls?: unknown;
  mergeTree?: string;
  headTree?: string;
  greenRuns?: number;
  failing?: string;
}

/** A fake GitHub API over one merged pull request. */
function github(repo: Repo = {}): GitHubGet {
  return (path) => {
    if (repo.failing !== undefined && path.includes(repo.failing)) return Promise.reject(new Error("HTTP 502"));
    if (path === `/repos/o/r/commits/${MERGE}/pulls`) {
      return Promise.resolve(repo.pulls ?? [{ number: 7, merge_commit_sha: MERGE, head: { sha: HEAD } }]);
    }
    if (path === `/repos/o/r/git/commits/${MERGE}`) return Promise.resolve({ tree: { sha: repo.mergeTree ?? "t1" } });
    if (path === `/repos/o/r/git/commits/${HEAD}`) return Promise.resolve({ tree: { sha: repo.headTree ?? "t1" } });
    if (path.startsWith("/repos/o/r/actions/workflows/ci.yml/runs?")) {
      expect(path).toContain(`head_sha=${HEAD}`);
      expect(path).toContain("status=success");
      return Promise.resolve({ total_count: repo.greenRuns ?? 1 });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  };
}

describe("a merge already checked", () => {
  it("is one whose tree is its pull request's head, and that head passed CI", async () => {
    const answer = await alreadyChecked("o/r", MERGE, github());
    expect(answer.checked).toBe(true);
    expect(answer.reason).toContain("#7");
  });

  it("is not one whose tree differs from the head, as when main moved on after the checks", async () => {
    expect((await alreadyChecked("o/r", MERGE, github({ headTree: "t0" }))).checked).toBe(false);
  });

  it("is not one whose pull request head never passed CI", async () => {
    expect((await alreadyChecked("o/r", MERGE, github({ greenRuns: 0 }))).checked).toBe(false);
  });

  it("is not a push that no pull request merged", async () => {
    expect((await alreadyChecked("o/r", MERGE, github({ pulls: [] }))).checked).toBe(false);
    const another = [{ number: 8, merge_commit_sha: "c".repeat(40), head: { sha: HEAD } }];
    expect((await alreadyChecked("o/r", MERGE, github({ pulls: another }))).checked).toBe(false);
  });

  it("is not anything GitHub could not tell us about: CI runs", async () => {
    const answer = await alreadyChecked("o/r", MERGE, github({ failing: "/actions/" }));
    expect(answer).toEqual({ checked: false, reason: "could not tell (HTTP 502), so CI runs" });
  });
});
