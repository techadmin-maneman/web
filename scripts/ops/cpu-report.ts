// mm-api's CPU time over the last day, from Workers analytics (scripts/lib/cpu-report.ts). Read-only. The staging
// deploy runs it after its smoke; for production, a token that reads analytics:
//
//   node --env-file=.env.cf-read scripts/ops/cpu-report.ts production
//
// It warns where a p99 is over the free plan's 10 ms, and exits 1 where Cloudflare stopped an invocation for a limit,
// which the deploy shows without failing. What it cannot read is a notice.

import { accountIdFor } from "../lib/cloudflare-api.ts";
import { judgeCpu, readCpu, type Level } from "../lib/cpu-report.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const environment = process.argv[2];
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
if ((environment !== "staging" && environment !== "production") || token === "") {
  console.error("usage: CLOUDFLARE_API_TOKEN=… node scripts/ops/cpu-report.ts <staging|production>");
  process.exit(2);
}

const script = `mm-api-${environment}`;
const until = new Date();
const answer = await readCpu({
  token,
  accountId: accountIdFor(environment),
  script,
  since: new Date(until.getTime() - DAY_MS),
  until,
});
const inActions = process.env.GITHUB_ACTIONS === "true";
if ("unreadable" in answer) {
  console.log(`${inActions ? "::notice::" : ""}${script}'s CPU time could not be read: ${answer.unreadable}`);
  process.exit(0);
}

/** GitHub Actions' annotation for each level, or the level itself in a terminal. */
const ANNOTATION: Readonly<Record<Level, string>> = { ok: "", warning: "::warning::", error: "::error::" };
const prefixFor = (level: Level): string => (inActions ? ANNOTATION[level] : `${level.toUpperCase()}  `);

const lines = judgeCpu(script, answer.reading);
console.log(`${script}, the last 24 hours:`);
for (const line of lines) console.log(`${prefixFor(line.level)}${line.text}`);
if (lines.some((line) => line.level === "error")) process.exit(1);
