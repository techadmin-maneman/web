// A ready pull request from a branch of this repository merges itself once a full CI run passes on its current head,
// unless it waits for a review (scripts/lib/auto-merge.ts).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOLD_LABEL,
  mergeVerdict,
  REVIEWED_LABEL,
  SENSITIVE_PATHS,
  sensitiveFiles,
  type PullRequest,
  type Run,
} from "../../scripts/lib/auto-merge.ts";

const PULL: PullRequest = {
  number: 7,
  state: "open",
  draft: false,
  headSha: "b",
  headRepository: "o/r",
  baseRepository: "o/r",
  labels: [],
  files: ["scripts/lib/already-checked.ts", "test/node/already-checked.test.ts"],
};
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

  // The repository is public: anyone can open a pull request from a fork.
  it("never merges a fork's pull request, even one whose run passed and that carries the reviewed label", () => {
    const fork = { merge: false, reason: "its branch is in a fork, not this repository" };
    expect(mergeVerdict({ ...PULL, headRepository: "someone/r" }, FULL)).toEqual(fork);
    expect(mergeVerdict({ ...PULL, headRepository: "someone/r", labels: [REVIEWED_LABEL] }, FULL)).toEqual(fork);
    expect(mergeVerdict({ ...PULL, headRepository: null }, FULL)).toEqual(fork);
  });

  it("waits on a run without the full suite, a failed run, a draft, an older head, a closed pull request, or the hold label", () => {
    const withoutSuite = { ...FULL, jobs: [{ name: "full suite", conclusion: "skipped" }] };
    expect(mergeVerdict(PULL, withoutSuite)).toEqual({ merge: false, reason: "the run did not pass the full suite" });
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

describe("a pull request touching money or personal data", () => {
  const refunds = { ...PULL, files: ["src/domain/refunds.ts", "test/worker/refunds.test.ts"] };

  // The audit's case (PLAT-91, CQ-73): nobody added the hold label, and the pull request merged on green.
  it("waits for the reviewed label with no label of any kind on it", () => {
    expect(mergeVerdict(refunds, FULL)).toEqual({
      merge: false,
      reason: `it touches money or personal data (src/domain/refunds.ts) and waits for the ${REVIEWED_LABEL} label`,
    });
  });

  it("merges once it carries the reviewed label", () => {
    expect(mergeVerdict({ ...refunds, labels: [REVIEWED_LABEL] }, FULL)).toEqual({ merge: true });
  });

  it("still waits on the hold label, reviewed or not", () => {
    const held = { ...refunds, labels: [REVIEWED_LABEL, HOLD_LABEL] };
    expect(mergeVerdict(held, FULL)).toEqual({ merge: false, reason: `it carries ${HOLD_LABEL}` });
  });

  it("still waits for a full run on its current head once reviewed", () => {
    const reviewed = { ...refunds, labels: [REVIEWED_LABEL] };
    expect(mergeVerdict(reviewed, { ...FULL, headSha: "a" }).merge).toBe(false);
  });

  it("counts a migration, a provider, a consent, an erasure and health data", () => {
    const files = [
      "migrations/0068_example.sql",
      "src/providers/razorpay.ts",
      "src/providers/books.ts",
      "src/policy/consents.ts",
      "src/domain/erasure.ts",
      "src/domain/hair-profiles.ts",
      "src/domain/discount-code-uses.ts",
      "src/domain/no-show-disputes.ts",
      "src/routes/razorpay-hook.ts",
    ];
    expect(sensitiveFiles(files)).toEqual(files);
  });

  it("leaves out tests, the apps' screens, scripts and documentation", () => {
    const files = [
      "test/worker/refunds.test.ts",
      "apps/ops/src/refunds.ts",
      "scripts/lib/auto-merge.ts",
      "docs/decisions/0006-deployment-pipeline.md",
      "src/domain/bookings.ts",
    ];
    expect(sensitiveFiles(files)).toEqual([]);
  });

  // A file renamed away from a sensitive path is listed under its old path as well (scripts/auto-merge.ts).
  it("counts a sensitive file renamed to a path outside the list", () => {
    const renamed = ["src/domain/money-back.ts", "src/domain/refunds.ts"];
    expect(sensitiveFiles(renamed)).toEqual(["src/domain/refunds.ts"]);
  });

  // A file renamed in the code would otherwise quietly fall out of the list.
  it("lists only paths that exist", () => {
    for (const path of SENSITIVE_PATHS) {
      if (path.endsWith("/")) {
        expect(existsSync(path), path).toBe(true);
        continue;
      }
      const folder = dirname(path);
      const matches = readdirSync(folder).filter((name) => join(folder, name).replaceAll("\\", "/").startsWith(path));
      expect(matches.length, path).toBeGreaterThan(0);
    }
  });
});

describe("a push after a review", () => {
  const workflow = readFileSync(".github/workflows/review-label.yml", "utf8");

  it("takes the reviewed label off on every push to a pull request that carries it", () => {
    expect(workflow).toMatch(/pull_request:\n\s+types: \[synchronize\]/);
    expect(workflow).toContain(`contains(github.event.pull_request.labels.*.name, '${REVIEWED_LABEL}')`);
    expect(workflow).toContain(`/labels/${REVIEWED_LABEL}"`);
  });

  // A later run of ci cancels an earlier one, which must never cancel the label coming off.
  it("is a workflow of its own, with no concurrency group to be cancelled by", () => {
    expect(workflow).not.toContain("concurrency");
  });
});
