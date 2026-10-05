// Prints, for each check CI may take as passed, whether the files this run checks already passed it
// (scripts/lib/already-checked.ts): static=true, tests=false, suite=false. The reason goes to stderr, for the log.
//
//   GITHUB_TOKEN=… node scripts/ci/already-checked.ts --repository owner/repo --commit <sha> [--head <sha>] >> "$GITHUB_OUTPUT"
//
// --head is a pull request's head, given when the run checks the head's own files; without it, --commit is a push to
// main.

import { parseArgs } from "node:util";
import { alreadyChecked, REUSABLE_CHECKS, type Answer, type ReusableCheck } from "../lib/already-checked.ts";

const { values } = parseArgs({
  options: { repository: { type: "string" }, commit: { type: "string" }, head: { type: "string" } },
});
const { repository = "", commit = "", head } = values;
const token = process.env.GITHUB_TOKEN ?? "";

async function get(path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${path}`);
  return response.json();
}

const answer: Answer =
  repository === "" || commit === "" || token === ""
    ? { passed: [], reason: "no repository, commit or token given" }
    : await alreadyChecked(repository, commit, get, head === "" ? undefined : head);

console.error(`already passed: ${answer.reason}`);
for (const check of Object.keys(REUSABLE_CHECKS) as ReusableCheck[]) {
  console.log(`${check}=${String(answer.passed.includes(check))}`);
}
