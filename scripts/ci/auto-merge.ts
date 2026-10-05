// Merges the pull request a passed CI run checked, if it should merge itself (scripts/lib/auto-merge.ts), and then
// starts the staging deploy: a merge made with the workflow's own token starts no workflow by its push.
//
//   GITHUB_TOKEN=… node scripts/ci/auto-merge.ts --repository owner/repo --run <ci run id>

import { parseArgs } from "node:util";
import { mergeVerdict } from "../lib/auto-merge.ts";

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
  head: { sha: string; repo: { full_name: string } | null };
  base: { repo: { full_name: string } };
  labels: { name: string }[];
}
interface FileAnswer {
  filename: string;
  previous_filename?: string;
}

const FILES_PER_PAGE = 100;

/** Every path the pull request changes, a page at a time; a renamed file counts under its old path too. */
async function changedFiles(number: number): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; ; page += 1) {
    const answer = (await github(
      "GET",
      `/pulls/${String(number)}/files?per_page=${String(FILES_PER_PAGE)}&page=${String(page)}`,
    )) as FileAnswer[];
    for (const file of answer) {
      files.push(file.filename);
      if (file.previous_filename !== undefined) files.push(file.previous_filename);
    }
    if (answer.length < FILES_PER_PAGE) return files;
  }
}

const run = (await github("GET", `/actions/runs/${runId}`)) as RunAnswer;
const [first] = run.pull_requests;
if (first === undefined) {
  console.log("no pull request: nothing to merge");
  process.exit(0);
}
const jobs = (await github("GET", `/actions/runs/${runId}/jobs?per_page=100`)) as JobsAnswer;
const pull = (await github("GET", `/pulls/${String(first.number)}`)) as PullAnswer;
const files = await changedFiles(pull.number);

const verdict = mergeVerdict(
  {
    number: pull.number,
    state: pull.state,
    draft: pull.draft,
    headSha: pull.head.sha,
    headRepository: pull.head.repo?.full_name ?? null,
    baseRepository: pull.base.repo.full_name,
    labels: pull.labels.map((label) => label.name),
    files,
  },
  { conclusion: run.conclusion, headSha: run.head_sha, jobs: jobs.jobs },
);
if (!verdict.merge) {
  console.log(`#${String(pull.number)} stays open: ${verdict.reason}`);
  process.exit(0);
}

const merged = await fetch(`https://api.github.com/repos/${repository}/pulls/${String(pull.number)}/merge`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  body: JSON.stringify({
    merge_method: "squash",
    sha: pull.head.sha,
    commit_title: `${pull.title} (#${String(pull.number)})`,
  }),
});
// 405: GitHub cannot merge it as it stands, most often a conflict with main, which only a new push can settle.
if (merged.status === 405) {
  console.log(`#${String(pull.number)} is not mergeable as it stands: merge main into it`);
  process.exit(0);
}
if (!merged.ok) throw new Error(`HTTP ${String(merged.status)} merging #${String(pull.number)}`);
await github("POST", "/actions/workflows/deploy-staging.yml/dispatches", { ref: "main" });
console.log(`#${String(pull.number)} merged, and the staging deploy started`);
