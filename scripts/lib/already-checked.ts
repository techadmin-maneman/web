// Whether a commit pushed to main has already passed CI, so the staging deploy
// need not run it again (docs/decisions/0006-deployment-pipeline.md).
//
// A squash merge of a pull request that was up to date with main has exactly
// the tree of the pull request's head. CI ran on that pull request against its
// merge with main, which then had the same tree. So when the pushed tree is the
// head's tree and that head passed CI, the deploy would only check the same
// files twice. Anything else, or anything GitHub cannot tell us, runs CI.
//
// It imports nothing from node_modules: its job installs nothing.

/** A GET on GitHub's REST API, answering the parsed JSON. */
export type GitHubGet = (path: string) => Promise<unknown>;

export interface Answer {
  readonly checked: boolean;
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

async function passedCi(get: GitHubGet, repository: string, head: string): Promise<boolean> {
  const query = `head_sha=${head}&event=pull_request&status=success&per_page=1`;
  const runs = await get(`/repos/${repository}/actions/workflows/ci.yml/runs?${query}`);
  const count = field(runs, "total_count");
  return typeof count === "number" && count > 0;
}

async function decide(get: GitHubGet, repository: string, commit: string): Promise<Answer> {
  const pull = await mergedPullRequest(get, repository, commit);
  if (pull === null) return { checked: false, reason: "no pull request's merge made this commit" };

  const [mergedTree, headTree] = await Promise.all([
    treeOf(get, repository, commit),
    treeOf(get, repository, pull.head),
  ]);
  if (mergedTree === undefined || mergedTree !== headTree) {
    return { checked: false, reason: `the merge's files differ from #${pull.number}'s head, which CI checked` };
  }
  if (!(await passedCi(get, repository, pull.head))) {
    return { checked: false, reason: `#${pull.number}'s head has no successful ci run` };
  }
  return { checked: true, reason: `the same files as #${pull.number}'s head, which passed ci` };
}

export async function alreadyChecked(repository: string, commit: string, get: GitHubGet): Promise<Answer> {
  try {
    return await decide(get, repository, commit);
  } catch (error) {
    return { checked: false, reason: `could not tell (${error instanceof Error ? error.message : ""}), so CI runs` };
  }
}
