// A ready pull request merges itself once a full CI run passes on its current head, unless it waits for a review
// (scripts/lib/auto-merge.ts, the owner's choice of 1 October 2026).

import { describe, expect, it } from "vitest";
import { HOLD_LABEL, mergeVerdict, type PullRequest, type Run } from "../../scripts/lib/auto-merge.ts";

const PULL: PullRequest = { number: 7, state: "open", draft: false, headSha: "b", labels: [] };
const FULL: Run = {
  conclusion: "success",
  headSha: "b",
  jobs: [
    { name: "tests (unit, contract, coverage)", conclusion: "success" },
    { name: "full suite", conclusion: "success" },
  ],
};

describe("a pull request merging itself", () => {
  it("merges a ready pull request whose full run passed on its head", () => {
    expect(mergeVerdict(PULL, FULL)).toEqual({ merge: true });
  });

  it("merges on a run of the touched apps alone, which is the full tier for that pull request", () => {
    const touched = { ...FULL, jobs: [{ name: "suite of the touched apps", conclusion: "success" }] };
    expect(mergeVerdict(PULL, touched)).toEqual({ merge: true });
  });

  it("waits on a quick run, a failed run, a draft, an older head, a closed pull request, or the hold label", () => {
    const quick = { ...FULL, jobs: [{ name: "full suite", conclusion: "skipped" }] };
    expect(mergeVerdict(PULL, quick)).toEqual({ merge: false, reason: "the run was the quick tier" });
    expect(mergeVerdict(PULL, { ...FULL, conclusion: "failure" }).merge).toBe(false);
    expect(mergeVerdict({ ...PULL, draft: true }, FULL).merge).toBe(false);
    expect(mergeVerdict({ ...PULL, headSha: "c" }, FULL)).toEqual({
      merge: false,
      reason: "the run was on an older head",
    });
    expect(mergeVerdict({ ...PULL, state: "closed" }, FULL).merge).toBe(false);
    expect(mergeVerdict({ ...PULL, labels: [HOLD_LABEL] }, FULL)).toEqual({
      merge: false,
      reason: `it carries ${HOLD_LABEL}`,
    });
  });
});
