// Which tier of CI an event runs (docs/decisions/0006-deployment-pipeline.md, "Two tiers"). The quick tier, the
// static checks and the unit and contract tests, runs on every push to a pull request. The full suite adds the
// build, the browser tests and Lighthouse, the deployed code on new migrations and the local smoke, and runs once a
// pull request is ready for review, again whenever it carries the full-ci label, and on every staging deploy, which
// checks what merged unless it is exactly a tree that passed the full suite.
//
// It imports nothing from node_modules: its job installs nothing.

export type CiTier = "full" | "quick";

/** The label that runs the full suite on a pull request's pushes, as long as it is on. */
export const FULL_CI_LABEL = "full-ci";

export interface CiEvent {
  /** GitHub's event: pull_request, or the push to main that a staging deploy calls CI for. */
  readonly event: string;
  /** The pull request's action: opened, synchronize, reopened, ready_for_review or labeled. */
  readonly action: string;
  readonly draft: boolean;
  /** The label just added, for a labeled event. */
  readonly label: string;
  /** Every label the pull request carries. */
  readonly labels: readonly string[];
}

export function ciTier(event: CiEvent): CiTier {
  if (event.event !== "pull_request") return "full";
  if (event.action === "ready_for_review") return "full";
  if ((event.action === "opened" || event.action === "reopened") && !event.draft) return "full";
  if (event.action === "labeled") return event.label === FULL_CI_LABEL ? "full" : "quick";
  return event.labels.includes(FULL_CI_LABEL) ? "full" : "quick";
}
