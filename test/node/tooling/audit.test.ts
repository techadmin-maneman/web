import { describe, expect, it } from "vitest";
import { failingAdvisories, type Allowance } from "../../../scripts/lib/audit.ts";

const ADVISORY = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc";
const report = (severity: string, url = ADVISORY) => ({
  vulnerabilities: {
    left: { via: [{ url, severity, title: "Left is unsafe" }] },
    parent: { via: ["left"] },
  },
});
const allowed: Allowance[] = [{ advisory: ADVISORY, reason: "dev only", until: "2026-11-03" }];

describe("the dependency audit", () => {
  it("fails on a high or critical advisory, once per advisory", () => {
    expect(failingAdvisories(report("high"), "2026-10-04", [])).toEqual([`left: Left is unsafe (${ADVISORY})`]);
    expect(failingAdvisories(report("critical"), "2026-10-04", [])).toHaveLength(1);
  });

  it("passes moderate and low advisories", () => {
    expect(failingAdvisories(report("moderate"), "2026-10-04", [])).toEqual([]);
  });

  it("lets a listed advisory through until its review date, and fails it after", () => {
    expect(failingAdvisories(report("high"), "2026-11-03", allowed)).toEqual([]);
    expect(failingAdvisories(report("high"), "2026-11-04", allowed)).toHaveLength(1);
  });

  it("lets through only the listed advisory", () => {
    const other = "https://github.com/advisories/GHSA-dddd-eeee-ffff";
    expect(failingAdvisories(report("high", other), "2026-10-04", allowed)).toEqual([
      `left: Left is unsafe (${other})`,
    ]);
  });
});
