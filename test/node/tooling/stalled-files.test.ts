// The run's watchdog (test/stalled-files.ts): a test file that stops reporting
// must end the run with its name, not hold it until CI's job times out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestModule } from "vitest/node";
import { StalledFiles } from "../../stalled-files.ts";

const file = (relativeModuleId: string) => ({ relativeModuleId }) as TestModule;

describe("the stalled-files watchdog", () => {
  let stopped: string[];
  let watchdog: StalledFiles;

  beforeEach(() => {
    vi.useFakeTimers();
    stopped = [];
    watchdog = new StalledFiles(60_000, (message) => stopped.push(message));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the run, naming each file still open, when no test has reported for the quiet period", () => {
    watchdog.onTestModuleStart(file("test/worker/booking/visit-changes.test.ts"));
    watchdog.onTestModuleStart(file("test/worker/privacy/dpdp.test.ts"));
    watchdog.onTestModuleEnd(file("test/worker/privacy/dpdp.test.ts"));

    vi.advanceTimersByTime(59_999);
    expect(stopped).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain("No test has reported for 1 minute");
    expect(stopped[0]).toContain("test/worker/booking/visit-changes.test.ts");
    expect(stopped[0]).not.toContain("dpdp");
  });

  it("waits the whole period again after each test reports", () => {
    watchdog.onTestModuleStart(file("test/worker/fsm.test.ts"));
    vi.advanceTimersByTime(50_000);
    watchdog.onTestCaseResult();
    vi.advanceTimersByTime(50_000);
    expect(stopped).toEqual([]);
  });

  it("says nothing once every file has finished, or the run has ended", () => {
    watchdog.onTestModuleStart(file("test/worker/fsm.test.ts"));
    watchdog.onTestModuleEnd(file("test/worker/fsm.test.ts"));
    vi.advanceTimersByTime(120_000);

    watchdog.onTestModuleStart(file("test/worker/privacy/dpdp.test.ts"));
    watchdog.onTestRunEnd();
    vi.advanceTimersByTime(120_000);

    expect(stopped).toEqual([]);
  });
});
