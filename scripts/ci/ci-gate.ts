// Fails the workflow's gate job unless every job it waits on passed or was skipped (scripts/lib/ci-gate.ts).
// RESULTS holds one "job result" to a line; the argument names what the jobs are, for the error.
//
//   RESULTS="build success" node scripts/ci/ci-gate.ts "checks"

import { failedJobs } from "../lib/ci-gate.ts";

const results = process.env.RESULTS ?? "";
const what = process.argv[2] ?? "jobs";
console.log(results.trim());
const failed = failedJobs(results);
if (failed.length > 0) {
  console.log(`::error::these ${what} did not pass: ${failed.join(" ")}`);
  process.exit(1);
}
