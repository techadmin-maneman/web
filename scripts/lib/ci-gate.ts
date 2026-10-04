// The gate a workflow's last job decides (.github/workflows/ci.yml, "full suite" and "checks"): every job it waits on
// passed, or was skipped for having nothing to do or having passed on these files already.

/** The jobs that neither passed nor were skipped, from GitHub's results one "job result" to a line. */
export function failedJobs(results: string): string[] {
  return results
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([job = "", result = ""]) => job !== "" && result !== "success" && result !== "skipped")
    .map(([job = ""]) => job);
}
