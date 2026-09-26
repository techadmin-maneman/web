// The test run's watchdog. Vitest waits for every test file to say it has
// finished, with no timeout of its own, so a file that stops reporting holds
// the whole run: on 26 September 2026 one held a CI job until its 25 minutes ran
// out, every one of its tests passed. If no test anywhere in the run reports for
// the quiet period while files are still open, this names them and ends the run.

import type { Reporter, TestModule } from "vitest/node";

/** Far longer than any gap between two tests here: a Worker test's own timeout is 30 seconds (vitest.config.ts). */
export const QUIET_MS = 3 * 60_000;

function endRun(message: string): void {
  console.error(message);
  process.exit(1);
}

export class StalledFiles implements Reporter {
  private readonly open = new Set<string>();
  private readonly quietMs: number;
  private readonly stop: (message: string) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(quietMs = QUIET_MS, stop: (message: string) => void = endRun) {
    this.quietMs = quietMs;
    this.stop = stop;
  }

  onTestModuleStart(testModule: TestModule): void {
    this.open.add(testModule.relativeModuleId);
    this.wait();
  }

  onTestCaseResult(): void {
    this.wait();
  }

  onTestModuleEnd(testModule: TestModule): void {
    this.open.delete(testModule.relativeModuleId);
    this.wait();
  }

  onTestRunEnd(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Starts the quiet period again. The timer is unref'd, so it never keeps a finished run alive. */
  private wait(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.stalled();
    }, this.quietMs);
    this.timer.unref();
  }

  private stalled(): void {
    if (this.open.size === 0) return;
    const minutes = this.quietMs / 60_000;
    this.stop(
      [
        `No test has reported for ${String(minutes)} minute${minutes === 1 ? "" : "s"}, and these files never said they had finished:`,
        ...[...this.open].map((id) => `  ${id}`),
        'The run is stopped here rather than left to CI\'s job timeout. See docs/getting-started.md, "A test run that stops".',
      ].join("\n"),
    );
  }
}
