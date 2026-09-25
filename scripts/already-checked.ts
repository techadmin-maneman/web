// Prints checked=true when the commit deploy-staging is about to deploy has the
// same files as a pull request head that passed CI, else checked=false
// (scripts/lib/already-checked.ts). The reason goes to stderr, for the log.
//
//   GITHUB_TOKEN=… node scripts/already-checked.ts --repository owner/repo --commit <sha> >> "$GITHUB_OUTPUT"

import { parseArgs } from "node:util";
import { alreadyChecked } from "./lib/already-checked.ts";

const { values } = parseArgs({ options: { repository: { type: "string" }, commit: { type: "string" } } });
const { repository = "", commit = "" } = values;
const token = process.env.GITHUB_TOKEN ?? "";

async function get(path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${path}`);
  return response.json();
}

const answer =
  repository === "" || commit === "" || token === ""
    ? { checked: false, reason: "no repository, commit or token given" }
    : await alreadyChecked(repository, commit, get);

console.error(`${answer.checked ? "already checked" : "CI runs"}: ${answer.reason}`);
console.log(`checked=${String(answer.checked)}`);
