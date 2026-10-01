// Whether a pull request merges itself once a CI run passes (the owner's choice of 1 October 2026; ADR 0006,
// "Merged when green"). GitHub's own auto-merge needs branch protection, which this plan has not, so a workflow
// asks this after every run of ci. A pull request merges when the run that passed was a full one on its current head,
// it is ready for review, and it does not carry the hold label, which a pull request touching money or personal data
// carries until its review is done.
//
// It imports nothing from node_modules: its job installs nothing.

/** The label that keeps a pull request from merging itself until it has been reviewed. */
export const HOLD_LABEL = "hold-for-review";

/** The jobs only a run of the full tier has (.github/workflows/ci.yml), the whole suite or the touched apps'. */
export const SUITE_JOBS = ["full suite", "suite of the touched apps"] as const;

export interface PullRequest {
  readonly number: number;
  readonly state: string;
  readonly draft: boolean;
  readonly headSha: string;
  readonly labels: readonly string[];
}

export interface Run {
  readonly conclusion: string;
  readonly headSha: string;
  readonly jobs: readonly { readonly name: string; readonly conclusion: string | null }[];
}

export type Verdict = { readonly merge: true } | { readonly merge: false; readonly reason: string };

export function mergeVerdict(pull: PullRequest, run: Run): Verdict {
  if (run.conclusion !== "success") return { merge: false, reason: "the run did not pass" };
  if (pull.state !== "open") return { merge: false, reason: "the pull request is not open" };
  if (pull.draft) return { merge: false, reason: "the pull request is a draft" };
  if (pull.labels.includes(HOLD_LABEL)) return { merge: false, reason: `it carries ${HOLD_LABEL}` };
  if (run.headSha !== pull.headSha) return { merge: false, reason: "the run was on an older head" };
  const suite = run.jobs.find((job) => (SUITE_JOBS as readonly string[]).includes(job.name));
  if (suite?.conclusion !== "success") return { merge: false, reason: "the run was the quick tier" };
  return { merge: true };
}
