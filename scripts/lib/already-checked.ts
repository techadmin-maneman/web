// Which of CI's checks the files a run is about to check have already passed, so that the run takes those as
// passed instead of running them again (docs/decisions/0006-deployment-pipeline.md, "Checks are not repeated").
//
// A pass counts only for exactly the same files. In a pull request, that is a run on the same head commit, made
// while the head held all of main, as this run's does: both then checked the head's own files, since main only
// moves forward. On a staging deploy, it is the merge of a pull request that was up to date with main, which has
// exactly the tree of the pull request's head, and the passes are that head's. A pass of any one check counts on
// its own: a run whose browser tests failed still passed its unit tests. Anything else, or anything GitHub cannot
// tell us, runs every check.
//
// It imports nothing from node_modules: its job installs nothing.

/** A GET on GitHub's REST API, answering the parsed JSON. */
export type GitHubGet = (path: string) => Promise<unknown>;

/** The checks a later run may take as passed, by the name of the job in .github/workflows/ci.yml that passes each. */
export const REUSABLE_CHECKS = {
  static: "static checks",
  tests: "tests (unit, contract, coverage)",
  suite: "full suite",
} as const;

export type ReusableCheck = keyof typeof REUSABLE_CHECKS;

/**
 * The jobs that do each check's work, by the start of their names. A check's own job passes when they were skipped,
 * as where a run's base already held its files and they had nothing to do; so a pass counts only from a run where
 * each of them ran and passed, never from one that skipped them.
 */
const WORK_JOBS: Readonly<Record<ReusableCheck, readonly string[]>> = {
  static: ["static checks"],
  tests: ["unit tests"],
  suite: ["build", "browser tests", "smoke (local)"],
};

/** The job whose pass covers the build, the browser tests, Lighthouse and the smoke. */
export const FULL_SUITE_JOB = REUSABLE_CHECKS.suite;

export interface Answer {
  /** The checks these files already passed. */
  readonly passed: readonly ReusableCheck[];
  readonly reason: string;
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The pull request whose merge made this commit, if one did. */
async function mergedPullRequest(get: GitHubGet, repository: string, commit: string) {
  const pulls = await get(`/repos/${repository}/commits/${commit}/pulls`);
  const merged = Array.isArray(pulls)
    ? (pulls as unknown[]).find((pull) => field(pull, "merge_commit_sha") === commit)
    : undefined;
  const head = field(merged, "head", "sha");
  return typeof head === "string" ? { number: String(field(merged, "number")), head } : null;
}

async function treeOf(get: GitHubGet, repository: string, commit: string): Promise<unknown> {
  return field(await get(`/repos/${repository}/git/commits/${commit}`), "tree", "sha");
}

/** Whether a run passed a check: its own job, and every job that does its work, ran and passed. */
function runPassed(jobs: readonly unknown[], check: ReusableCheck): boolean {
  const conclusionsOf = (start: string) =>
    jobs.filter((job) => String(field(job, "name")).startsWith(start)).map((job) => field(job, "conclusion"));
  const own = conclusionsOf(REUSABLE_CHECKS[check]);
  if (!own.includes("success")) return false;
  return WORK_JOBS[check].every((start) => {
    const work = conclusionsOf(start);
    return work.length > 0 && work.every((conclusion) => conclusion === "success");
  });
}

/** Every reusable check one of the head's ci runs passed, whatever became of the rest of that run. */
async function passedOnHead(get: GitHubGet, repository: string, head: string): Promise<ReusableCheck[]> {
  const query = `head_sha=${head}&event=pull_request&per_page=20`;
  const runs = field(await get(`/repos/${repository}/actions/workflows/ci.yml/runs?${query}`), "workflow_runs");
  if (!Array.isArray(runs)) return [];
  const passed = new Set<ReusableCheck>();
  for (const run of runs as unknown[]) {
    const jobs = field(
      await get(`/repos/${repository}/actions/runs/${String(field(run, "id"))}/jobs?per_page=100`),
      "jobs",
    );
    if (!Array.isArray(jobs)) continue;
    for (const check of Object.keys(REUSABLE_CHECKS) as ReusableCheck[]) {
      if (runPassed(jobs as unknown[], check)) passed.add(check);
    }
  }
  return (Object.keys(REUSABLE_CHECKS) as ReusableCheck[]).filter((check) => passed.has(check));
}

function said(passed: readonly ReusableCheck[]): string {
  return passed.length === 0 ? "none of the checks" : passed.map((check) => REUSABLE_CHECKS[check]).join(", ");
}

/** On a staging deploy: the checks the head of the pull request that made this merge passed, if the files are its. */
async function passedOnMerge(get: GitHubGet, repository: string, commit: string): Promise<Answer> {
  const pull = await mergedPullRequest(get, repository, commit);
  if (pull === null) return { passed: [], reason: "no pull request's merge made this commit" };

  const [mergedTree, headTree] = await Promise.all([
    treeOf(get, repository, commit),
    treeOf(get, repository, pull.head),
  ]);
  if (mergedTree === undefined || mergedTree !== headTree) {
    return { passed: [], reason: `the merge's files differ from #${pull.number}'s head, which CI checked` };
  }
  const passed = await passedOnHead(get, repository, pull.head);
  return { passed, reason: `the same files as #${pull.number}'s head, which passed ${said(passed)}` };
}

/**
 * The checks these files already passed. `head` is a pull request's head, given only when the run checks the head's
 * own files; without it, `commit` is a push to main, which a pull request's merge may have made.
 */
export async function alreadyChecked(
  repository: string,
  commit: string,
  get: GitHubGet,
  head?: string,
): Promise<Answer> {
  try {
    if (head === undefined) return await passedOnMerge(get, repository, commit);
    const passed = await passedOnHead(get, repository, head);
    return { passed, reason: `this head, an earlier run of which passed ${said(passed)}` };
  } catch (error) {
    return {
      passed: [],
      reason: `could not tell (${error instanceof Error ? error.message : ""}), so every check runs`,
    };
  }
}
