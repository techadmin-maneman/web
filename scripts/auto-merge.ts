// Merges the pull request a passed CI run checked, if it should merge itself (scripts/lib/auto-merge.ts), and then
// starts the staging deploy: a merge made with the workflow's own token starts no workflow by its push.
//
//   GITHUB_TOKEN=… node scripts/auto-merge.ts --repository owner/repo --run <ci run id>

import { parseArgs } from "node:util";
import { mergeVerdict } from "./lib/auto-merge.ts";

const { values } = parseArgs({ options: { repository: { type: "string" }, run: { type: "string" } } });
const repository = values.repository ?? "";
const runId = values.run ?? "";
const token = process.env.GITHUB_TOKEN ?? "";

async function github(method: string, path: string, body?: object): Promise<unknown> {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${method} ${path}`);
  return response.status === 204 ? null : response.json();
}

interface RunAnswer {
  conclusion: string;
  head_sha: string;
  pull_requests: { number: number }[];
}
interface JobsAnswer {
  jobs: { name: string; conclusion: string | null }[];
}
interface PullAnswer {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  head: { sha: string };
  labels: { name: string }[];
}

const run = (await github("GET", `/actions/runs/${runId}`)) as RunAnswer;
const [first] = run.pull_requests;
if (first === undefined) {
  console.log("no pull request: nothing to merge");
  process.exit(0);
}
const jobs = (await github("GET", `/actions/runs/${runId}/jobs?per_page=100`)) as JobsAnswer;
const pull = (await github("GET", `/pulls/${String(first.number)}`)) as PullAnswer;

const verdict = mergeVerdict(
  {
    number: pull.number,
    state: pull.state,
    draft: pull.draft,
    headSha: pull.head.sha,
    labels: pull.labels.map((label) => label.name),
  },
  { conclusion: run.conclusion, headSha: run.head_sha, jobs: jobs.jobs },
);
if (!verdict.merge) {
  console.log(`#${String(pull.number)} stays open: ${verdict.reason}`);
  process.exit(0);
}

await github("PUT", `/pulls/${String(pull.number)}/merge`, {
  merge_method: "squash",
  sha: pull.head.sha,
  commit_title: `${pull.title} (#${String(pull.number)})`,
});
await github("POST", "/actions/workflows/deploy-staging.yml/dispatches", { ref: "main" });
console.log(`#${String(pull.number)} merged, and the staging deploy started`);
