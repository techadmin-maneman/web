// A test that passed only on its retry, said on the pull request as a warning beside its line: CI retries a failed
// browser test once, which passes the run, so without this a flaky test is seen only by the nightly run.

import type { FullResult, Reporter, TestCase } from "@playwright/test/reporter";

export default class FlakyReporter implements Reporter {
  private readonly flaky: TestCase[] = [];

  onTestEnd(test: TestCase): void {
    if (test.outcome() === "flaky") this.flaky.push(test);
  }

  onEnd(_result: FullResult): void {
    for (const test of this.flaky) {
      const where = `file=${test.location.file},line=${String(test.location.line)}`;
      console.log(`::warning ${where},title=Flaky test::${test.titlePath().join(" › ")} passed only on a retry`);
    }
  }
}
