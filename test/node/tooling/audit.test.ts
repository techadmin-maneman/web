import { describe, expect, it } from "vitest";
import { failingAdvisories, noAudit, type Allowance } from "../../../scripts/lib/audit.ts";

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

  // npm writes its own failures to stdout as JSON as well, and exits 0: the check once passed on nothing when the
  // registry could not be reached.
  it("is no audit where npm answers its own error, or anything but its report", () => {
    const unreachable = {
      message: "request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED",
      error: { summary: "", detail: "" },
    };
    expect(noAudit(unreachable, { production: false })).toContain("ECONNREFUSED");
    expect(noAudit({}, { production: false })).toBe("npm audit gave no report");
    const report = { auditReportVersion: 2, vulnerabilities: {}, metadata: { dependencies: { prod: 36 } } };
    expect(noAudit(report, { production: true })).toBeNull();
  });

  it("is no audit of the production dependencies where it checked none of them", () => {
    const none = { auditReportVersion: 2, vulnerabilities: {}, metadata: { dependencies: { prod: 0 } } };
    expect(noAudit(none, { production: true })).toBe("npm audit checked no production dependency");
    expect(noAudit(none, { production: false })).toBeNull();
  });
});
