// Warns, without failing, when a pull request changes more lines a person wrote than one review can hold
// (scripts/lib/pr-size.ts; CONTRIBUTING.md, "Keep it small").
//
//   node scripts/check-pr-size.ts origin/main

import { execFileSync } from "node:child_process";
import { REVIEWABLE_LINES, writtenLines } from "./lib/pr-size.ts";

const base = process.argv[2] ?? "origin/main";
const numstat = execFileSync("git", ["diff", "--numstat", `${base}...HEAD`], { encoding: "utf8" });
const lines = writtenLines(numstat);
if (lines > REVIEWABLE_LINES) {
  // GitHub shows a "::warning::" line on the pull request's checks.
  console.log(
    `::warning::${String(lines)} lines changed in files people wrote, past the ${String(REVIEWABLE_LINES)} one review ` +
      'can hold: split it if it can be split (CONTRIBUTING.md, "Keep it small").',
  );
} else {
  console.log(`${String(lines)} lines changed in files people wrote, of ${String(REVIEWABLE_LINES)}`);
}
